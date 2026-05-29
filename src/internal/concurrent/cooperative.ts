import { Async } from '../../Async.js'
import { at } from '../../Breadcrumb.js'
import { Fork } from './effects.js'
import { Fail } from '../../Fail.js'
import { flatMap, flatten, Fx, fx, ok, runPromise } from '../../Fx.js'
import { Handle } from '../../Handler.js'
import { HandlerCapture, handleCaptured, withCapturedHandlers } from '../../HandlerCapture.js'
import { Task } from '../../Task.js'
import type { TraceOrigin } from '../../Trace.js'
import { captureTrace, getTrace } from '../../Trace.js'
import { ForkError, capturePrependTraceWithContext, originOfUnhandledFail, runtimeContextOfEffect, traceUnhandledFail, traceWithCause } from '../forkDiagnostics.js'
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from '../interrupt.js'
import { withInterpretedReturn } from '../iteratorClose.js'
import { currentRuntimeContext, getRuntimeContext, withActiveRuntimeContext } from '../runtimeContext.js'

export interface CooperativeConfig {
  readonly concurrency: number
  readonly yieldBudget: number
}

export interface CoopConcurrencyOptions {
  readonly concurrency?: number
  readonly yieldBudget?: number
}

/**
 * Provide cooperative scheduling for explicit or scoped Fork requests.
 */
export const withCoopConcurrency = (options: CoopConcurrencyOptions = {}) => {
  const normalized = normalizeCoopOptions(options, 'withCoopConcurrency')
  const runtime = new CooperativeRuntime(normalized)
  return <const E, const A>(f: Fx<E, A>): Fx<CoopConcurrencyHandledEffects<E>, A> =>
    withCapturedHandlers('fx/Concurrent/Fork', f).pipe(
      flatMap(fx =>
        ok(fx.pipe(
          handleCaptured('fx/Concurrent/Fork', Fork, runtime.runFork)
        ))
      ),
      flatten
    ) as Fx<CoopConcurrencyHandledEffects<E>, A>
}

type CoopConcurrencyHandledEffects<E> =
  Handle<Handle<E, Fork>, HandlerCapture<'fx/Concurrent/Fork'>>

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

export class CooperativeRuntime {
  private slotWaiters = [] as (() => void)[]
  private availableSlots: number

  constructor(readonly config: CooperativeConfig) {
    this.availableSlots = Math.floor(config.concurrency)
  }

  readonly runFork = (fork: Fork): Fx<never, Task<unknown, unknown>> =>
    fx(function* (this: CooperativeRuntime) {
      return this.startFork(fork)
    }.bind(this))

  startFork(fork: Fork, onUnhandled?: (error: unknown) => void): Task<unknown, unknown> {
    const context = getRuntimeContext(fork) ?? currentRuntimeContext()
    const origin = fork.arg.origin
    const trace = fork.arg.trace
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
        if (fiber.masks.canInterrupt) fiber.abort?.abort(reason)
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
          await runPromise(fx(function* (this: CooperativeRuntime) { yield* closeFiber(this, fiber) }.bind(this)) as Fx<any, void>)
          finishDetachedFiber(this, fiber)
          if (fiber.cleanupFailures.length > 0) {
            const failure = resourceReleaseFailed(fiber.cleanupFailures)
            done.reject(failure)
            throw failure
          }
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
      throw error
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

const normalizeCoopOptions = (options: CoopConcurrencyOptions, handlerName: string): CooperativeConfig => {
  const concurrency = options.concurrency ?? Infinity
  const yieldBudget = options.yieldBudget ?? 64
  if (concurrency <= 0 || (concurrency !== Infinity && !Number.isInteger(concurrency))) {
    throw new RangeError(`${handlerName} concurrency must be a positive integer or Infinity, got ${concurrency}`)
  }
  if (yieldBudget <= 0 || !Number.isInteger(yieldBudget)) {
    throw new RangeError(`${handlerName} yieldBudget must be a positive integer, got ${yieldBudget}`)
  }
  return {
    concurrency,
    yieldBudget
  }
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
        yield* closeFiber(runtime, fiber)
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

function* closeFiber(
  runtime: CooperativeRuntime,
  fiber: Fiber
): Generator<unknown, void, unknown> {
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
      } else if (Fork.is(ir.value)) {
        ir = fiber.iterator.next(runtime.startFork(ir.value))
      } else if (Fail.is(ir.value)) {
        fiber.cleanupFailures.push(ir.value.arg)
        return
      } else if (InterruptMaskBegin.is(ir.value)) {
        fiber.masks.mask(ir.value.arg)
        ir = fiber.iterator.next()
      } else if (InterruptMaskEnd.is(ir.value)) {
        fiber.masks.unmask(ir.value.arg)
        ir = fiber.iterator.next()
      } else if (HandlerCapture.is(ir.value)) {
        const releaseSlotBeforeResume = fiber.slotAcquired
        if (releaseSlotBeforeResume) runtime.releaseSlot(fiber)
        try {
          ir = fiber.iterator.next(yield* runCleanupEffect(runtime, fiber, ir.value))
        } finally {
          if (releaseSlotBeforeResume) yield* reacquireSlot(runtime, fiber)
        }
      } else {
        ir = fiber.iterator.next(yield* runCleanupEffect(runtime, fiber, ir.value))
      }
    } catch (e) {
      fiber.cleanupFailures.push(e)
      return
    }
  }
}

const runCleanupEffect = (
  runtime: CooperativeRuntime,
  fiber: Fiber,
  effect: unknown
) =>
  withCapturedHandlers('fx/Concurrent/Fork', fx(function* () {
    return yield effect as any
  })).pipe(
    flatMap(fx =>
      ok(fx.pipe(
        handleCaptured('fx/Concurrent/Fork', Fork, runtime.runFork)
      ))
    ),
    flatten
  ) as Fx<unknown, unknown>

const finishDetachedFiber = (runtime: CooperativeRuntime, fiber: Fiber) => {
  if (fiber.status === 'done') return
  fiber.status = 'done'
  fiber.abort?.abort()
  runtime.releaseSlot(fiber)
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

const resourceReleaseFailed = (failures: readonly unknown[]) =>
  new AggregateError(failures, 'Resource release failed')
