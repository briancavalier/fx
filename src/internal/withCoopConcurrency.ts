import { Async } from '../Async.js'
import { at, indexed } from '../Breadcrumb.js'
import { Concurrently, RaceAllFailed, allPolicy, firstSettledPolicy, firstSuccessPolicy } from '../Concurrent.js'
import type { ConcurrentPolicy, ConcurrentResult, EffectsOf, ErrorsOf } from '../Concurrent.js'
import { Fail, fail } from '../Fail.js'
import { Fx, fx } from '../Fx.js'
import type { TraceFrameKind, TraceOrigin } from '../Trace.js'
import { captureTrace, getTrace } from '../Trace.js'
import { ForkError, capturePrependTraceWithContext, captureTraceWithContext, originOfUnhandledFail, runtimeContextOfEffect, traceUnhandledFail, traceWithCause } from './forkDiagnostics.js'
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from './interrupt.js'
import { withInterpretedReturn } from './iteratorClose.js'
import { getRuntimeContext, withActiveRuntimeContext } from './runtimeContext.js'

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
  status: 'ready' | 'waiting' | 'done'
  resume: Resume
  abort?: AbortController
  cancelRequested: boolean
  cleanupFailures: unknown[]
}

type PrimaryFailure =
  | { readonly error: unknown }

type GroupDecision<S> =
  | { readonly type: 'continue', readonly state: S }
  | { readonly type: 'succeed', readonly state: S, readonly value: unknown, readonly cancelRest: boolean }
  | { readonly type: 'fail', readonly state: S, readonly error: unknown, readonly cancelRest: boolean }

interface GroupPolicy<S> {
  readonly init: (size: number) => S
  readonly onEmpty?: (state: S) => GroupDecision<S>
  readonly onSuccess: (state: S, index: number, value: unknown) => GroupDecision<S>
  readonly onFailure: (state: S, index: number, error: unknown) => GroupDecision<S>
}

export const runCooperativeConcurrently = (config: CooperativeConfig) =>
  <const Policy extends ConcurrentPolicy, const Fxs extends readonly Fx<unknown, unknown>[]>(
    group: Concurrently<Policy, Fxs>
  ): Fx<CooperativeConcurrentlyEffects<Concurrently<Policy, Fxs>>, ConcurrentResult<Policy, Fxs>> =>
    cooperativeGroupFx(group, config, groupPolicy(group.arg.policy)) as Fx<CooperativeConcurrentlyEffects<Concurrently<Policy, Fxs>>, ConcurrentResult<Policy, Fxs>>

const cooperativeGroupFx = <const Fxs extends readonly Fx<unknown, unknown>[], S>(
  group: Concurrently<ConcurrentPolicy, Fxs>,
  config: CooperativeConfig,
  policy: GroupPolicy<S>
) => fx(function* () {
  const fxs = group.arg.fxs
  const fibers = [] as Fiber[]
  const ready = [] as Fiber[]
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
    while (outcome === undefined && active < config.concurrency && next < fxs.length) {
      const fiber: Fiber = {
        index: next,
        iterator: fxs[next][Symbol.iterator](),
        traceOrigin: childTraceOriginWithContext(context, parentTraceOrigin, next, childKind),
        masks: new InterruptMaskState(),
        status: 'ready',
        resume: { type: 'next', value: undefined },
        cancelRequested: false,
        cleanupFailures: []
      }
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
    active--
    done++
  }

  const settle = (decision: GroupDecision<S>) => {
    state = decision.state
    if (decision.type === 'continue') return
    outcome ??= decision
    if (decision.cancelRest) cancelActiveFibers(fibers)
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

      if (ready.length === 0) {
        if (active === 0) break
        ready.push(...(yield* wake.wait()))
        continue
      }

      const fiber = ready.shift()!
      if (fiber.status !== 'ready') continue
      if (fiber.cancelRequested && fiber.masks.canInterrupt) {
        yield* closeFiber(fiber)
        finish(fiber)
        continue
      }

      let budget = config.yieldBudget
      while (budget > 0 && fiber.status === 'ready') {
        budget--
        let ir: IteratorResult<unknown, unknown>
        try {
          ir = fiber.resume.type === 'throw'
            ? fiber.iterator.throw?.(fiber.resume.error) ?? throwIntoMissingIterator(fiber.resume.error)
            : fiber.iterator.next(fiber.resume.value)
        } catch (e) {
          failFiber(fiber, { error: wrapThrownFiberError(fiber, e) })
          break
        }
        fiber.resume = { type: 'next', value: undefined }

        if (ir.done) {
          succeedFiber(fiber, ir.value)
          break
        }

        if (Async.is(ir.value)) {
          startCooperativeAsync(fiber, ir.value, wake, failFiber)
          break
        }

        if (Concurrently.is(ir.value)) {
          fiber.resume = { type: 'next', value: yield* runCooperativeConcurrently(config)(ir.value as Concurrently<ConcurrentPolicy, readonly Fx<unknown, unknown>[]>) }
          continue
        }

        if (Fail.is(ir.value)) {
          failFiber(fiber, { error: wrapFiberFailure(fiber, ir.value) })
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
            finish(fiber)
            break
          }
          fiber.resume = { type: 'next', value: undefined }
          continue
        }

        fiber.resume = { type: 'next', value: yield ir.value as any }
      }

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
  if (policy === allPolicy) return allGroupPolicy()
  if (policy === firstSettledPolicy) return raceGroupPolicy()
  if (policy === firstSuccessPolicy) return firstSuccessGroupPolicy()
  throw new TypeError('Unknown concurrency policy')
}

const allGroupPolicy = (): GroupPolicy<{ readonly results: unknown[], completed: number }> => ({
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
})

const raceGroupPolicy = (): GroupPolicy<void> => ({
  init: () => undefined,
  onSuccess: (_state, _index, value) => ({ type: 'succeed', state: undefined, value, cancelRest: true }),
  onFailure: (_state, _index, error) => ({ type: 'fail', state: undefined, error, cancelRest: true })
})

const firstSuccessGroupPolicy = (): GroupPolicy<{ readonly size: number, readonly failures: unknown[] }> => ({
  init: size => ({ size, failures: sparseArray(size) }),
  onEmpty: state => ({ type: 'fail', state, error: new RaceAllFailed(state.failures), cancelRest: false }),
  onSuccess: (state, _index, value) => ({ type: 'succeed', state, value, cancelRest: true }),
  onFailure: (state, index, error) => {
    state.failures[index] = error
    const failed = state.failures.filter((_, i) => i in state.failures).length
    return failed === state.size
      ? { type: 'fail', state, error: new RaceAllFailed(state.failures), cancelRest: true }
      : { type: 'continue', state }
  }
})

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
  const context = runtimeContextOfEffect(failure)
  const causeTrace = getTrace(failure.arg)
  const trace = traceUnhandledFail(failure, causeTrace, fiber.traceOrigin.trace, context)
  const origin = originOfUnhandledFail(failure, causeTrace)
  return new ForkError('FX_UNHANDLED_FAILURE', 'Unhandled failure in forked task', origin, trace, context, { cause: failure.arg })
}

const wrapThrownFiberError = (fiber: Fiber, error: unknown): ForkError => {
  const context = runtimeContextOfEffect(error)
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
  private readonly waiters = [] as (() => void)[]

  ready(fiber: Fiber) {
    this.readyFibers.push(fiber)
    this.notify()
  }

  notify() {
    const waiters = this.waiters.splice(0)
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

const resourceReleaseFailed = (failures: readonly unknown[]) =>
  new AggregateError(failures, 'Resource release failed')
