import { Async } from '../Async.js'
import { at, indexed } from '../Breadcrumb.js'
import { Concurrently, Fork, RaceAllFailed, allPolicy, firstSettledPolicy, firstSuccessPolicy } from '../Concurrent.js'
import type { ConcurrentPolicy, ConcurrentResult, EffectsOf, ErrorsOf } from '../Concurrent.js'
import { Fail, fail } from '../Fail.js'
import { Fx, fx, runPromise } from '../Fx.js'
import { HandlerCapture } from '../HandlerCapture.js'
import { Task } from '../Task.js'
import type { TraceFrameKind, TraceOrigin } from '../Trace.js'
import { captureTrace, getTrace } from '../Trace.js'
import { ForkError, capturePrependTraceWithContext, captureTraceWithContext, forkFrameMetadata, originOfUnhandledFail, runtimeContextOfEffect, traceUnhandledFail, traceWithCause } from './forkDiagnostics.js'
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from './interrupt.js'
import { withInterpretedReturn } from './iteratorClose.js'
import { currentRuntimeContext, getRuntimeContext, withActiveRuntimeContext } from './runtimeContext.js'

export interface CooperativeConfig {
  readonly concurrency: number
  readonly yieldBudget: number
}

export type CooperativeConcurrentlyEffects<E> = E extends Concurrently<infer Policy, infer Fxs>
  ? Policy['tag'] extends 'firstSuccess' ? Async | FirstSuccessFailure<Fxs> : Async | ErrorsOf<EffectsOf<Fxs[number]>>
  : never
type FirstSuccessFailure<Fxs extends readonly Fx<unknown, unknown>[]> =
  EveryFxCanFail<Fxs> extends true ? Fail<RaceAllFailed<FailuresOfFxs<Fxs>>> : never
type EveryFxCanFail<Fxs extends readonly Fx<unknown, unknown>[]> = Fxs extends readonly []
  ? true
  : number extends Fxs['length']
  ? true
  : Fxs extends readonly [infer F, ...infer Rest]
  ? F extends Fx<unknown, unknown>
  ? [FailuresOfFx<F>] extends [never]
  ? false
  : Rest extends readonly Fx<unknown, unknown>[] ? EveryFxCanFail<Rest> : true
  : false
  : true
type FailuresOfFxs<Fxs extends readonly Fx<unknown, unknown>[]> = {
  readonly [K in keyof Fxs]: FailuresOfFx<Fxs[K]>
}
type FailuresOfFx<F> = FailureOf<ErrorsOf<EffectsOf<F>>>
type FailureOf<E> = E extends Fail<infer F> ? F : never

type Resume =
  | { readonly type: 'next', readonly value: unknown }
  | { readonly type: 'throw', readonly error: unknown }

interface Fiber {
  readonly index: number
  readonly iterator: Iterator<unknown, unknown, unknown>
  readonly traceOrigin: TraceOrigin
  readonly masks: InterruptMaskState
  readonly runtimeContext: ReturnType<typeof getRuntimeContext>
  slotAcquired: boolean
  status: 'ready' | 'waiting' | 'done'
  resume: Resume
  abort?: AbortController
  cancelRequested: boolean
  cleanupFailures: unknown[]
  releaseSlotBeforeResume: boolean
}

type PrimaryFailure =
  | { readonly error: unknown }

type GroupDecision<S> =
  | { readonly type: 'continue', readonly state: S }
  | { readonly type: 'pending', readonly state: S }
  | { readonly type: 'succeed', readonly state: S, readonly value: unknown, readonly cancelRest: boolean }
  | { readonly type: 'fail', readonly state: S, readonly error: unknown, readonly cancelRest: boolean }

interface GroupPolicy<S> {
  readonly init: (size: number) => S
  readonly onEmpty?: (state: S) => GroupDecision<S>
  readonly onSuccess: (state: S, index: number, value: unknown) => GroupDecision<S>
  readonly onFailure: (state: S, index: number, error: unknown) => GroupDecision<S>
}

export class CooperativeRuntime {
  private slotWaiters = [] as (() => void)[]
  private availableSlots: number

  constructor(readonly config: CooperativeConfig) {
    this.availableSlots = Math.floor(config.concurrency)
  }

  readonly runConcurrently = <const Policy extends ConcurrentPolicy, const Fxs extends readonly Fx<unknown, unknown>[]>(
    group: Concurrently<Policy, Fxs>
  ): Fx<CooperativeConcurrentlyEffects<Concurrently<Policy, Fxs>>, ConcurrentResult<Policy, Fxs>> =>
    cooperativeGroupFx(this, group, groupPolicy(group.arg.policy)) as Fx<CooperativeConcurrentlyEffects<Concurrently<Policy, Fxs>>, ConcurrentResult<Policy, Fxs>>

  readonly runNestedConcurrently = <const Policy extends ConcurrentPolicy, const Fxs extends readonly Fx<unknown, unknown>[]>(
    group: Concurrently<Policy, Fxs>,
    parent: Fiber
  ): Fx<CooperativeConcurrentlyEffects<Concurrently<Policy, Fxs>>, ConcurrentResult<Policy, Fxs>> =>
    cooperativeGroupFx(this, group, groupPolicy(group.arg.policy), parent) as Fx<CooperativeConcurrentlyEffects<Concurrently<Policy, Fxs>>, ConcurrentResult<Policy, Fxs>>

  readonly runFork = (fork: Fork): Fx<never, Task<unknown, unknown>> =>
    fx(function* (this: CooperativeRuntime) {
      return this.startFork(fork)
    }.bind(this))

  startFork(fork: Fork, onUnhandled?: (error: unknown) => void): Task<unknown, unknown> {
    const context = getRuntimeContext(fork) ?? currentRuntimeContext()
    const origin = fork.arg.origin
    const trace = capturePrependTraceWithContext(context, origin, fork.arg.trace, forkFrameMetadata(fork.arg.trace))
    const fiber: Fiber = {
      index: -1,
      iterator: fork.arg.fx[Symbol.iterator](),
      traceOrigin: { origin, trace },
      runtimeContext: context,
      masks: new InterruptMaskState(),
      slotAcquired: false,
      status: 'ready',
      resume: { type: 'next', value: undefined },
      cancelRequested: false,
      cleanupFailures: [],
      releaseSlotBeforeResume: false
    }
    const done = Promise.withResolvers<unknown>()
    const interrupted = Promise.withResolvers<void>()
    let cleanup: Promise<void> = Promise.resolve()
    let running = false
    const wake = new Wake()
    const task = new Task<unknown, unknown>(
      done.promise,
      reason => {
        fiber.cancelRequested = true
        fiber.abort?.abort(reason)
        this.notifySlotWaiters()
        if (!running) {
          cleanup = this.drainFork(fiber, done)
          running = true
        }
        cleanup.then(() => interrupted.resolve(), error => interrupted.reject(error))
      },
      context,
      interrupted.promise
    )
    this.tryAcquireSlot(fiber)
    done.promise.catch(error => {
      queueMicrotask(() => {
        if (task._handled || task._interrupted || fiber.cancelRequested) return
        onUnhandled?.(new ForkError('FX_UNHANDLED_FORK_FAILURE', 'Unhandled failure in forked task', origin, traceWithCause(trace, error, runtimeContextOfEffect(error, context), getTrace(error)), runtimeContextOfEffect(error, context), { cause: error }))
      })
    })
    queueMicrotask(() => {
      if (running) return
      running = true
      cleanup = this.drainFork(fiber, done, wake)
    })
    return task
  }

  private async drainFork(fiber: Fiber, done: PromiseWithResolvers<unknown>, wake = new Wake()): Promise<void> {
    try {
      while (!fiber.slotAcquired) {
        if (fiber.cancelRequested) {
          finishDetachedFiber(this, fiber)
          return
        }
        if (this.tryAcquireSlot(fiber)) break
        await this.waitForSlotPromise()
      }
      while (fiber.status !== 'done') {
        if (fiber.status === 'waiting') {
          await runPromise(wake.wait())
          continue
        }
        if (fiber.cancelRequested && fiber.masks.canInterrupt) {
          await runPromise(fx(function* () { yield* closeFiber(fiber) }) as Fx<any, void>)
          finishDetachedFiber(this, fiber)
          if (fiber.cleanupFailures.length > 0) done.reject(resourceReleaseFailed(fiber.cleanupFailures))
          return
        }
        const step = stepFiber(this, fiber, wake, {
          succeed: value => {
            finishDetachedFiber(this, fiber)
            done.resolve(value)
          },
          fail: error => {
            finishDetachedFiber(this, fiber)
            done.reject(error)
          },
          cancel: () => {
            finishDetachedFiber(this, fiber)
          }
        })
        await runPromise(fx(function* () { yield* step }) as Fx<any, void>)
        if (fiber.status === 'ready') await Promise.resolve()
      }
    } catch (error) {
      finishDetachedFiber(this, fiber)
      done.reject(error)
    }
  }

  tryAcquireSlot(fiber: Fiber): boolean {
    if (fiber.slotAcquired) return true
    if (this.availableSlots <= 0) return false
    this.availableSlots--
    fiber.slotAcquired = true
    return true
  }

  releaseSlot(fiber: Fiber) {
    if (!fiber.slotAcquired) return
    fiber.slotAcquired = false
    this.availableSlots++
    this.notifySlotWaiters()
  }

  waitForSlot() {
    return AsyncWait(this.slotWaiters)
  }

  private waitForSlotPromise() {
    if (this.availableSlots > 0) return Promise.resolve()
    return new Promise<void>(resolve => this.slotWaiters.push(resolve))
  }

  private notifySlotWaiters() {
    if (this.slotWaiters.length === 0) return
    const waiters = this.slotWaiters
    this.slotWaiters = []
    for (const waiter of waiters) waiter()
  }
}

const cooperativeGroupFx = <const Fxs extends readonly Fx<unknown, unknown>[], S>(
  runtime: CooperativeRuntime,
  group: Concurrently<ConcurrentPolicy, Fxs>,
  policy: GroupPolicy<S>,
  borrowedSlotFrom?: Fiber
) => fx(function* () {
  const fxs = group.arg.fxs
  const fibers = [] as Fiber[]
  const ready = [] as Fiber[]
  let readyIndex = 0
  const wake = new Wake()
  const context = getRuntimeContext(group)
  const parentTraceOrigin = {
    origin: group.arg.origin,
    trace: group.arg.trace ?? captureTraceWithContext(context, group.arg.origin, undefined, { kind: groupKind(group) })
  }
  const childKind = childFrameKind(parentTraceOrigin.trace)
  let state = policy.init(fxs.length)
  let next = 0
  let active = 0
  let done = 0
  let completed = false
  let outcome: Exclude<GroupDecision<S>, { readonly type: 'continue' }> | undefined = emptyOutcome(policy, state, fxs.length)

  const startNext = () => {
    while (outcome === undefined && next < fxs.length) {
      const fiber: Fiber = {
        index: next,
        iterator: fxs[next][Symbol.iterator](),
        traceOrigin: childTraceOriginWithContext(context, parentTraceOrigin, next, childKind),
        runtimeContext: context,
        masks: new InterruptMaskState(),
        slotAcquired: false,
        status: 'ready',
        resume: { type: 'next', value: undefined },
        cancelRequested: false,
        cleanupFailures: [],
        releaseSlotBeforeResume: false
      }
      if (borrowedSlotFrom?.slotAcquired) {
        borrowedSlotFrom.slotAcquired = false
        fiber.slotAcquired = true
      } else if (!runtime.tryAcquireSlot(fiber)) break
      next++
      active++
      fibers.push(fiber)
      ready.push(fiber)
    }
  }

  const finish = (fiber: Fiber) => {
    if (fiber.status === 'done') return
    fiber.status = 'done'
    fiber.abort?.abort()
    runtime.releaseSlot(fiber)
    active--
    done++
  }

  const settle = (decision: GroupDecision<S>) => {
    state = decision.state
    if (decision.type === 'continue') return
    outcome ??= decision
    if (decision.type !== 'pending' && decision.cancelRest) cancelActiveFibers(fibers)
  }

  const succeedFiber = (fiber: Fiber, value: unknown) => {
    finish(fiber)
    settle(policy.onSuccess(state, fiber.index, value))
  }

  const failFiber = (fiber: Fiber, failure: PrimaryFailure) => {
    finish(fiber)
    settle(policy.onFailure(state, fiber.index, failure.error))
  }

  try {
    while (done < fxs.length || next < fxs.length) {
      startNext()

      if (readyIndex >= ready.length) {
        ready.length = 0
        readyIndex = 0
        if (active === 0 && next < fxs.length) {
          yield* runtime.waitForSlot()
          continue
        }
        if (active === 0) break
        appendReady(ready, yield* wake.wait())
        continue
      }

      const fiber = ready[readyIndex++]!
      if (readyIndex > 64 && readyIndex * 2 > ready.length) {
        ready.splice(0, readyIndex)
        readyIndex = 0
      }
      if (fiber.status !== 'ready') continue
      if (fiber.cancelRequested && fiber.masks.canInterrupt) {
        yield* closeFiber(fiber)
        finish(fiber)
        continue
      }

      yield* stepFiber(runtime, fiber, wake, {
        succeed: value => succeedFiber(fiber, value),
        fail: error => failFiber(fiber, { error }),
        cancel: () => finish(fiber)
      })

      if (fiber.status === 'ready') ready.push(fiber)
    }

    completed = true

    if (outcome !== undefined) {
      cancelActiveFibers(fibers)
      for (const fiber of fibers) {
        if (fiber.status !== 'done') {
          yield* closeFiber(fiber)
          finish(fiber)
        }
      }

      const cleanupFailures = fibers.flatMap(fiber => fiber.cleanupFailures)
      if (cleanupFailures.length > 0) {
        const failures = outcome.type === 'fail'
          ? [outcome.error, ...cleanupFailures]
          : cleanupFailures
        return (yield* fail(resourceReleaseFailed(failures))) as never
      }
      if (outcome.type === 'pending') return yield* waitForInterruption()
      if (outcome.type === 'fail') return (yield* fail(outcome.error)) as never
      return outcome.value
    }

    return state
  } finally {
    if (!completed) {
      cancelActiveFibers(fibers)
      for (const fiber of fibers) {
        if (fiber.status !== 'done') {
          yield* closeFiber(fiber)
          finish(fiber)
        }
      }
    }
  }
})

const emptyOutcome = <S>(
  policy: GroupPolicy<S>,
  state: S,
  size: number
): Exclude<GroupDecision<S>, { readonly type: 'continue' }> | undefined => {
  if (size !== 0) return undefined
  const decision = policy.onEmpty?.(state)
  return decision?.type === 'continue' ? undefined : decision
}

const groupKind = (group: Concurrently<ConcurrentPolicy, any>): TraceFrameKind =>
  group.arg.policy.tag === 'all' ? 'all' : 'race'

const childFrameKind = (trace: TraceOrigin['trace'] | undefined) =>
  trace?.frame.kind === 'all' || trace?.frame.kind === 'race' ? trace.frame.kind : 'fork'

const groupPolicy = (policy: ConcurrentPolicy): GroupPolicy<any> => {
  if (policy === allPolicy) return allGroupPolicy
  if (policy === firstSettledPolicy) return raceGroupPolicy
  if (policy === firstSuccessPolicy) return firstSuccessGroupPolicy
  throw new TypeError('Unknown concurrency policy')
}

const allGroupPolicy: GroupPolicy<{ readonly results: unknown[], completed: number }> = {
  init: size => ({ results: sparseArray(size), completed: 0 }),
  onEmpty: state => ({ type: 'succeed', state, value: state.results, cancelRest: false }),
  onSuccess: (state, index, value) => {
    state.results[index] = value
    state.completed++
    return state.completed === state.results.length
      ? { type: 'succeed', state, value: state.results, cancelRest: false }
      : { type: 'continue', state }
  },
  onFailure: (state, _index, error) => ({ type: 'fail', state, error, cancelRest: true })
}

const raceGroupPolicy: GroupPolicy<void> = {
  init: () => undefined,
  onEmpty: state => ({ type: 'pending', state }),
  onSuccess: (_state, _index, value) => ({ type: 'succeed', state: undefined, value, cancelRest: true }),
  onFailure: (_state, _index, error) => ({ type: 'fail', state: undefined, error, cancelRest: true })
}

const firstSuccessGroupPolicy: GroupPolicy<{ readonly size: number, readonly failures: unknown[], failed: number }> = {
  init: size => ({ size, failures: sparseArray(size), failed: 0 }),
  onEmpty: state => ({ type: 'fail', state, error: new RaceAllFailed(state.failures), cancelRest: false }),
  onSuccess: (state, _index, value) => ({ type: 'succeed', state, value, cancelRest: true }),
  onFailure: (state, index, error) => {
    state.failures[index] = error
    state.failed++
    return state.failed === state.size
      ? { type: 'fail', state, error: new RaceAllFailed(state.failures), cancelRest: true }
      : { type: 'continue', state }
  }
}

const appendReady = (ready: Fiber[], fibers: readonly Fiber[]) => {
  for (const fiber of fibers) ready.push(fiber)
}

const sparseArray = (length: number): unknown[] => {
  const array = [] as unknown[]
  array.length = length
  return array
}

const startCooperativeAsync = (
  fiber: Fiber,
  async: Async,
  wake: Wake,
  failFiber: (fiber: Fiber, failure: PrimaryFailure) => void
) => {
  const abort = new AbortController()
  fiber.abort = abort
  fiber.status = 'waiting'
  const context = getRuntimeContext(async)
  const run = () => async.arg.run(abort.signal)
  const promise = context === undefined ? run() : withActiveRuntimeContext(context, run)
  const wakeOnAbort = () => {
    if (fiber.status !== 'waiting') return
    fiber.abort = undefined
    fiber.status = 'ready'
    wake.ready(fiber)
  }
  abort.signal.addEventListener('abort', wakeOnAbort, { once: true })
  promise.then(
    value => {
      if (fiber.status !== 'waiting') return
      abort.signal.removeEventListener('abort', wakeOnAbort)
      fiber.abort = undefined
      fiber.resume = { type: 'next', value }
      fiber.status = 'ready'
      wake.ready(fiber)
    },
    error => {
      if (fiber.status !== 'waiting') return
      abort.signal.removeEventListener('abort', wakeOnAbort)
      fiber.abort = undefined
      failFiber(fiber, { error: wrapAsyncFiberError(fiber, async, error, context) })
      wake.notify()
    }
  )
}

interface FiberCallbacks {
  readonly succeed: (value: unknown) => void
  readonly fail: (error: unknown) => void
  readonly cancel?: () => void
}

function* stepFiber(
  runtime: CooperativeRuntime,
  fiber: Fiber,
  wake: Wake,
  callbacks: FiberCallbacks
): Generator<unknown, void, unknown> {
  let budget = runtime.config.yieldBudget
  while (budget > 0 && fiber.status === 'ready') {
    budget--
    let ir: IteratorResult<unknown, unknown>
    const releaseSlotBeforeResume = fiber.releaseSlotBeforeResume && fiber.slotAcquired
    fiber.releaseSlotBeforeResume = false
    if (releaseSlotBeforeResume) runtime.releaseSlot(fiber)
    try {
      ir = fiber.resume.type === 'throw'
        ? fiber.iterator.throw?.(fiber.resume.error) ?? throwIntoMissingIterator(fiber.resume.error)
        : fiber.iterator.next(fiber.resume.value)
    } catch (e) {
      callbacks.fail(wrapThrownFiberError(fiber, e))
      break
    } finally {
      if (releaseSlotBeforeResume) yield* reacquireSlot(runtime, fiber)
    }
    fiber.resume = { type: 'next', value: undefined }

    if (ir.done) {
      callbacks.succeed(ir.value)
      break
    }

    if (Async.is(ir.value)) {
      startCooperativeAsync(fiber, ir.value, wake, (_fiber, failure) => {
        callbacks.fail(failure.error)
      })
      break
    }

    if (Concurrently.is(ir.value)) {
      try {
        fiber.resume = { type: 'next', value: yield* runtime.runNestedConcurrently(ir.value as Concurrently<ConcurrentPolicy, readonly Fx<unknown, unknown>[]>, fiber) }
      } finally {
        yield* reacquireSlot(runtime, fiber)
      }
      continue
    }

    if (Fork.is(ir.value)) {
      fiber.resume = {
        type: 'next',
        value: runtime.startFork(ir.value, error => {
          if (fiber.status === 'done') return
          callbacks.fail(error)
          wake.notify()
        })
      }
      continue
    }

    if (Fail.is(ir.value)) {
      callbacks.fail(wrapFiberFailure(fiber, ir.value))
      break
    }

    if (InterruptMaskBegin.is(ir.value)) {
      fiber.masks.mask(ir.value.arg)
      fiber.resume = { type: 'next', value: undefined }
      continue
    }

    if (InterruptMaskEnd.is(ir.value)) {
      fiber.masks.unmask(ir.value.arg)
      if (fiber.cancelRequested && fiber.masks.canInterrupt) {
        yield* closeFiber(fiber)
        callbacks.cancel?.()
        break
      }
      fiber.resume = { type: 'next', value: undefined }
      continue
    }

    if (HandlerCapture.is(ir.value)) {
      fiber.resume = { type: 'next', value: yield ir.value as any }
      fiber.releaseSlotBeforeResume = true
      continue
    }

    fiber.resume = { type: 'next', value: yield ir.value as any }
  }
}

function* reacquireSlot(
  runtime: CooperativeRuntime,
  fiber: Fiber
): Generator<unknown, void, unknown> {
  if (fiber.status === 'done') return
  while (!runtime.tryAcquireSlot(fiber)) yield* runtime.waitForSlot()
}

function* closeFiber(fiber: Fiber): Generator<unknown, void, unknown> {
  fiber.abort?.abort()
  fiber.abort = undefined
  let ir: IteratorResult<unknown, unknown>
  try {
    ir = withInterpretedReturn(() => fiber.iterator.return?.() ?? { done: true, value: undefined })
  } catch (e) {
    fiber.cleanupFailures.push(e)
    return
  }

  while (!ir.done) {
    try {
      if (Async.is(ir.value)) {
        ir = fiber.iterator.next(yield ir.value as any)
      } else if (Fail.is(ir.value)) {
        fiber.cleanupFailures.push(ir.value.arg)
        return
      } else if (InterruptMaskBegin.is(ir.value)) {
        fiber.masks.mask(ir.value.arg)
        ir = fiber.iterator.next()
      } else if (InterruptMaskEnd.is(ir.value)) {
        fiber.masks.unmask(ir.value.arg)
        ir = fiber.iterator.next()
      } else {
        ir = fiber.iterator.next(yield ir.value as any)
      }
    } catch (e) {
      fiber.cleanupFailures.push(e)
      return
    }
  }
}

const finishDetachedFiber = (runtime: CooperativeRuntime, fiber: Fiber) => {
  if (fiber.status === 'done') return
  fiber.status = 'done'
  fiber.abort?.abort()
  runtime.releaseSlot(fiber)
}

const cancelActiveFibers = (fibers: readonly Fiber[], except?: Fiber) => {
  for (const fiber of fibers) {
    if (fiber === except || fiber.status === 'done') continue
    fiber.cancelRequested = true
    if (fiber.masks.canInterrupt) {
      fiber.abort?.abort()
    }
  }
}

const wrapFiberFailure = (fiber: Fiber, failure: Fail<unknown>): ForkError => {
  const context = runtimeContextOfEffect(failure, fiber.runtimeContext)
  const causeTrace = getTrace(failure.arg)
  const trace = traceUnhandledFail(failure, causeTrace, fiber.traceOrigin.trace, context)
  const origin = originOfUnhandledFail(failure, causeTrace)
  return new ForkError('FX_UNHANDLED_FAILURE', 'Unhandled failure in forked task', origin, trace, context, { cause: failure.arg })
}

const wrapThrownFiberError = (fiber: Fiber, error: unknown): ForkError => {
  const context = runtimeContextOfEffect(error, fiber.runtimeContext)
  return new ForkError('FX_UNHANDLED_EXCEPTION', 'Unhandled exception in forked task', fiber.traceOrigin.origin, traceWithCause(fiber.traceOrigin.trace, error, context, getTrace(error)), context, { cause: error })
}

const wrapAsyncFiberError = (fiber: Fiber, async: Async, error: unknown, fallbackContext?: ReturnType<typeof getRuntimeContext>): ForkError => {
  const context = runtimeContextOfEffect(error, fallbackContext)
  const asyncTrace = capturePrependTraceWithContext(context, async.arg.origin, fiber.traceOrigin.trace, { kind: 'async' })
  return new ForkError('FX_AWAITED_ASYNC_FAILED', 'Awaited Async task failed', async.arg.origin, traceWithCause(asyncTrace, error, context, getTrace(error)), context, { cause: error })
}

const childTraceOriginWithContext = (
  context: ReturnType<typeof getRuntimeContext>,
  parent: TraceOrigin,
  index: number,
  kind: TraceFrameKind
): TraceOrigin => {
  const origin = indexed(parent.origin, index)
  return { origin, trace: captureTraceWithContext(context, origin, parent.trace, { kind, index }) }
}

const throwIntoMissingIterator = (error: unknown): never => {
  throw error
}

class Wake {
  private readonly readyFibers = [] as Fiber[]
  private waiters = [] as (() => void)[]

  ready(fiber: Fiber) {
    this.readyFibers.push(fiber)
    this.notify()
  }

  notify() {
    if (this.waiters.length === 0) return
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter()
  }

  wait() {
    return fx(function* (this: Wake) {
      if (this.readyFibers.length === 0) {
        yield* AsyncWait(this.waiters)
      }
      return this.readyFibers.splice(0)
    }.bind(this))
  }
}

const AsyncWait = (waiters: (() => void)[]) =>
  new Async({
    run: signal => new Promise<void>(resolve => {
      const resolveOnce = () => {
        signal.removeEventListener('abort', resolveOnce)
        resolve()
      }
      signal.addEventListener('abort', resolveOnce, { once: true })
      waiters.push(resolveOnce)
    }),
    origin: at('fx/Concurrent/withCoopConcurrency/wait', AsyncWait),
    trace: captureTrace(at('fx/Concurrent/withCoopConcurrency/wait', AsyncWait), undefined, { kind: 'async' })
  }) as Fx<Async, void>

const waitForInterruption = () =>
  new Async({
    run: signal => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
    origin: at('fx/Concurrent/withCoopConcurrency/pending', waitForInterruption),
    trace: captureTrace(at('fx/Concurrent/withCoopConcurrency/pending', waitForInterruption), undefined, { kind: 'async' })
  }) as Fx<Async, never>

const resourceReleaseFailed = (failures: readonly unknown[]) =>
  new AggregateError(failures, 'Resource release failed')
