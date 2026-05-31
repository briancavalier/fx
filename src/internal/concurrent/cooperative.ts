import { Async } from '../../Async.js'
import { at } from '../../Breadcrumb.js'
import { Fork } from './effects.js'
import { Fail } from '../../Fail.js'
import { flatMap, flatten, Fx, fx, ok, runPromise } from '../../Fx.js'
import { Handle } from '../../Handler.js'
import { HandlerCapture, captureHandlers, closeHandlerCapture, handleCaptured, withCapturedHandlers, withHandlerContext } from '../../HandlerCapture.js'
import type { CapturedHandler } from '../../HandlerCapture.js'
import { Task } from '../../Task.js'
import type { TraceOrigin } from '../../Trace.js'
import { captureTrace, getTrace } from '../../Trace.js'
import { ForkError, capturePrependTraceWithContext, originOfUnhandledFail, runtimeContextOfEffect, traceUnhandledFail, traceWithCause } from '../forkDiagnostics.js'
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from '../interrupt.js'
import { withInterpretedReturn } from '../iteratorClose.js'
import { attachRuntimeContext, currentRuntimeContext, getRuntimeContext, runtimeScopeExit, RuntimeScopeExit, withActiveRuntimeContext } from '../runtimeContext.js'
import { shouldReleaseSlotForAsync } from './cooperativeAsync.js'

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
  return <const E, const A>(f: Fx<E, A>): Fx<CoopConcurrencyHandledEffects<E>, A> =>
    captureHandlers('fx/Concurrent/Fork').pipe(
      flatMap(handlers => {
        const runtime = new CooperativeRuntime(normalized, handlers)
        return ok(withHandlerContext(handlers.filter(isRootBoundaryHandler), f).pipe(
          closeHandlerCapture('fx/Concurrent/ForkIn'),
          handleCaptured('fx/Concurrent/Fork', Fork, runtime.runFork)
        ))
      }),
      flatten
    ) as Fx<CoopConcurrencyHandledEffects<E>, A>
}

type CoopConcurrencyHandledEffects<E> =
  Handle<Handle<E, Fork>, HandlerCapture<'fx/Concurrent/Fork'>>

const isRootBoundaryHandler = (handler: CapturedHandler): boolean =>
  (handler as { readonly rootBoundary?: boolean }).rootBoundary === true

type Resume =
  | { readonly type: 'next', readonly value: unknown }
  | { readonly type: 'throw', readonly error: unknown }

interface Fiber {
  readonly index: number
  readonly fx: Fx<unknown, unknown>
  readonly traceOrigin: TraceOrigin
  readonly masks: InterruptMaskState
  readonly runtimeContext: ReturnType<typeof getRuntimeContext>
  readonly done: PromiseWithResolvers<unknown>
  readonly interrupted: PromiseWithResolvers<void>
  iterator?: Iterator<unknown, unknown, unknown>
  slotAcquired: boolean
  status: 'ready' | 'running' | 'waiting' | 'done'
  resume: Resume
  abort?: AbortController
  cancelRequested: boolean
  cleanupFailures: unknown[]
  releaseSlotBeforeResume: boolean
  queued: boolean
}

type PrimaryFailure =
  | { readonly error: unknown }

export class CooperativeRuntime {
  private readonly readyFibers = [] as Fiber[]
  private readonly yieldedFibers = [] as Fiber[]
  private slotWaiters = [] as (() => void)[]
  private availableSlots: number
  private pumpScheduled = false
  private pumping = false

  constructor(
    readonly config: CooperativeConfig,
    readonly handlers: readonly CapturedHandler[] = []
  ) {
    this.availableSlots = Math.floor(config.concurrency)
  }

  readonly runFork = (fork: Fork): Fx<never, Task<unknown, unknown>> =>
    fx(function* (this: CooperativeRuntime) {
      return this.startFork(this.wrapFork(fork))
    }.bind(this))

  startFork(fork: Fork, onUnhandled?: (error: unknown) => void): Task<unknown, unknown> {
    const context = getRuntimeContext(fork) ?? currentRuntimeContext()
    const origin = fork.arg.origin
    const trace = fork.arg.trace
    const done = Promise.withResolvers<unknown>()
    const interrupted = Promise.withResolvers<void>()
    const fiber: Fiber = {
      index: -1,
      fx: fork.arg.fx,
      traceOrigin: { origin, trace },
      runtimeContext: context,
      done,
      interrupted,
      masks: new InterruptMaskState(),
      slotAcquired: false,
      status: 'ready',
      resume: { type: 'next', value: undefined },
      cancelRequested: false,
      cleanupFailures: [],
      releaseSlotBeforeResume: false,
      queued: false
    }
    const task = new Task<unknown, unknown>(
      done.promise,
      reason => {
        fiber.cancelRequested = true
        if (fiber.masks.canInterrupt && fiber.status === 'waiting') {
          fiber.status = 'ready'
          this.enqueue(fiber)
        } else if (fiber.masks.canInterrupt) {
          fiber.abort?.abort(reason)
        }
        if (fiber.status === 'ready') this.enqueue(fiber)
        this.schedulePump()
        if (fiber.status === 'done') interrupted.resolve()
      },
      context,
      interrupted.promise
    )
    done.promise.catch(error => {
      queueMicrotask(() => {
        if (task._handled || task._interrupted || fiber.cancelRequested) return
        onUnhandled?.(new ForkError('FX_UNHANDLED_FORK_FAILURE', 'Unhandled failure in forked task', origin, traceWithCause(trace, error, runtimeContextOfEffect(error, context), getTrace(error)), runtimeContextOfEffect(error, context), { cause: error }))
      })
    })
    this.enqueue(fiber)
    return task
  }

  enqueue(fiber: Fiber) {
    if (fiber.status !== 'ready' || fiber.queued) return
    fiber.queued = true
    this.readyFibers.push(fiber)
    this.schedulePump()
  }

  private enqueueYielded(fiber: Fiber) {
    if (fiber.status !== 'ready' || fiber.queued) return
    fiber.queued = true
    this.yieldedFibers.push(fiber)
    this.schedulePump()
  }

  private schedulePump() {
    if (this.pumpScheduled || this.pumping) return
    this.pumpScheduled = true
    setTimeout(() => {
      setTimeout(() => {
        this.pumpScheduled = false
        void this.pump()
      }, 0)
    }, 0)
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      let fiber: Fiber | undefined
      while ((fiber = this.takeRunnableFiber()) !== undefined) {
        fiber.status = 'running'
        await this.runFiberTurn(fiber)
      }
    } finally {
      this.pumping = false
      if (this.hasRunnableFiber()) this.schedulePump()
    }
  }

  private takeRunnableFiber(): Fiber | undefined {
    this.pruneQueue(this.readyFibers)
    this.pruneQueue(this.yieldedFibers)
    return this.takeRunnableFromQueue(this.readyFibers)
      ?? this.takeRunnableFromQueue(this.yieldedFibers)
  }

  private hasRunnableFiber(): boolean {
    return this.hasRunnableQueuedFiber(this.readyFibers) || this.hasRunnableQueuedFiber(this.yieldedFibers)
  }

  private pruneQueue(queue: Fiber[]) {
    for (let i = 0; i < queue.length; ++i) {
      if (queue[i].status !== 'ready') {
        queue[i].queued = false
        void queue.splice(i, 1)
        --i
      }
    }
  }

  private takeRunnableFromQueue(queue: Fiber[]): Fiber | undefined {
    for (let i = 0; i < queue.length; ++i) {
      const fiber = queue[i]
      if (fiber.slotAcquired || fiber.cancelRequested || this.availableSlots > 0) return this.takeQueuedFiber(queue, i)
    }
  }

  private takeQueuedFiber(queue: Fiber[], index: number): Fiber {
    const [fiber] = queue.splice(index, 1)
    fiber.queued = false
    return fiber
  }

  private hasRunnableQueuedFiber(queue: Fiber[]): boolean {
    return queue.some(fiber =>
      fiber.status === 'ready' && (fiber.slotAcquired || this.availableSlots > 0 || fiber.cancelRequested)
    )
  }

  private async runFiberTurn(fiber: Fiber): Promise<void> {
    try {
      if (!fiber.slotAcquired) {
        if (fiber.cancelRequested) {
          finishFiber(this, fiber)
          return
        }
        if (!this.tryAcquireSlot(fiber)) {
          fiber.status = 'ready'
          this.enqueue(fiber)
          return
        }
      }

      if (fiber.cancelRequested && fiber.masks.canInterrupt) {
        await runPromise(fx(function* (this: CooperativeRuntime) { yield* closeFiber(this, fiber) }.bind(this)) as Fx<any, void>)
        if (fiber.cleanupFailures.length > 0) {
          finishInterruptedFiber(this, fiber, resourceReleaseFailed(fiber.cleanupFailures))
        } else {
          finishInterruptedFiber(this, fiber)
        }
        return
      }

      const step = stepFiber(this, fiber, {
        succeed: value => {
          finishFiber(this, fiber)
          fiber.done.resolve(value)
        },
        fail: error => {
          finishFiber(this, fiber)
          fiber.done.reject(error)
        },
        cancel: () => {
          if (fiber.cleanupFailures.length > 0) {
            finishInterruptedFiber(this, fiber, resourceReleaseFailed(fiber.cleanupFailures))
          } else {
            finishInterruptedFiber(this, fiber)
          }
        }
      })
      await runPromise(withHandlerContext(this.handlers, fx(function* () { yield* step })) as Fx<any, void>)
      if (fiber.status === 'running') {
        fiber.status = 'ready'
        this.enqueueYielded(fiber)
      }
    } catch (error) {
      finishFiber(this, fiber)
      fiber.done.reject(error)
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
    this.schedulePump()
  }

  waitForSlot() {
    return AsyncWait(this.slotWaiters)
  }

  private notifySlotWaiters(forceAll = false) {
    if (this.slotWaiters.length === 0) return
    const count = forceAll || this.availableSlots === Infinity
      ? this.slotWaiters.length
      : Math.min(this.slotWaiters.length, Math.max(0, this.availableSlots))
    if (count === 0) return
    const waiters = this.slotWaiters.splice(0, count)
    for (const waiter of waiters) waiter()
  }

  wrapFork(fork: Fork): Fork {
    if (this.handlers.length === 0) return fork
    const wrapped = new Fork({
      ...fork.arg,
      fx: fork.arg.fx
    })
    attachRuntimeContext(wrapped, getRuntimeContext(fork))
    return wrapped
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
  runtime: CooperativeRuntime,
  fiber: Fiber,
  async: Async,
  failFiber: (fiber: Fiber, failure: PrimaryFailure) => void
) => {
  const abort = new AbortController()
  fiber.abort = abort
  fiber.status = 'waiting'
  if (shouldReleaseSlotForAsync(async)) runtime.releaseSlot(fiber)
  const context = getRuntimeContext(async)
  const run = () => async.arg.run(abort.signal)
  const promise = context === undefined ? run() : withActiveRuntimeContext(context, run)
  const scopeExit = fiber.masks.canInterrupt ? runtimeScopeExit(context) : undefined
  const wakeOnAbort = () => {
    if (fiber.status !== 'waiting') return
    fiber.abort = undefined
    fiber.status = 'ready'
    runtime.enqueue(fiber)
  }
  abort.signal.addEventListener('abort', wakeOnAbort, { once: true })
  Promise.race(scopeExit === undefined ? [promise] : [promise, scopeExit]).then(
    value => {
      if (fiber.status !== 'waiting') return
      abort.signal.removeEventListener('abort', wakeOnAbort)
      fiber.abort = undefined
      if (value instanceof RuntimeScopeExit) abort.abort(value.reason)
      fiber.resume = { type: 'next', value }
      fiber.status = 'ready'
      runtime.enqueue(fiber)
    },
    error => {
      if (fiber.status !== 'waiting') return
      abort.signal.removeEventListener('abort', wakeOnAbort)
      fiber.abort = undefined
      failFiber(fiber, { error: wrapAsyncFiberError(fiber, async, error, context) })
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
  callbacks: FiberCallbacks
): Generator<unknown, void, unknown> {
  let budget = runtime.config.yieldBudget
  while (budget > 0 && fiber.status === 'running') {
    budget--
    let ir: IteratorResult<unknown, unknown>
    const releaseSlotBeforeResume = fiber.releaseSlotBeforeResume && fiber.slotAcquired
    fiber.releaseSlotBeforeResume = false
    if (releaseSlotBeforeResume) runtime.releaseSlot(fiber)
    try {
      const iterator = fiberIterator(fiber)
      ir = fiber.resume.type === 'throw'
        ? iterator.throw?.(fiber.resume.error) ?? throwIntoMissingIterator(fiber.resume.error)
        : iterator.next(fiber.resume.value)
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
      startCooperativeAsync(runtime, fiber, ir.value, (_fiber, failure) => {
        callbacks.fail(failure.error)
      })
      break
    }

    if (Fork.is(ir.value)) {
      fiber.resume = {
        type: 'next',
        value: runtime.startFork(ir.value)
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
  const iterator = fiber.iterator
  if (iterator === undefined) return
  let ir: IteratorResult<unknown, unknown>
  try {
    ir = withInterpretedReturn(() => iterator.return?.() ?? { done: true, value: undefined })
  } catch (e) {
    fiber.cleanupFailures.push(e)
    return
  }

  while (!ir.done) {
    try {
      if (Async.is(ir.value)) {
        ir = iterator.next(yield ir.value as any)
      } else if (Fork.is(ir.value)) {
        ir = iterator.next(runtime.startFork(runtime.wrapFork(ir.value)))
      } else if (Fail.is(ir.value)) {
        fiber.cleanupFailures.push(ir.value.arg)
        return
      } else if (InterruptMaskBegin.is(ir.value)) {
        fiber.masks.mask(ir.value.arg)
        ir = iterator.next()
      } else if (InterruptMaskEnd.is(ir.value)) {
        fiber.masks.unmask(ir.value.arg)
        ir = iterator.next()
      } else if (HandlerCapture.is(ir.value)) {
        const releaseSlotBeforeResume = fiber.slotAcquired
        if (releaseSlotBeforeResume) runtime.releaseSlot(fiber)
        try {
          ir = iterator.next(yield* runCleanupEffect(runtime, fiber, ir.value))
        } finally {
          if (releaseSlotBeforeResume) yield* reacquireSlot(runtime, fiber)
        }
      } else {
        ir = iterator.next(yield* runCleanupEffect(runtime, fiber, ir.value))
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
  withHandlerContext(
    runtime.handlers,
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
  )

const finishFiber = (runtime: CooperativeRuntime, fiber: Fiber) => {
  if (fiber.status === 'done') return
  fiber.status = 'done'
  fiber.abort?.abort()
  runtime.releaseSlot(fiber)
  fiber.interrupted.resolve()
}

const finishInterruptedFiber = (runtime: CooperativeRuntime, fiber: Fiber, failure?: unknown) => {
  if (fiber.status === 'done') return
  fiber.status = 'done'
  fiber.abort?.abort()
  runtime.releaseSlot(fiber)
  if (failure === undefined) {
    fiber.interrupted.resolve()
  } else {
    fiber.done.reject(failure)
    fiber.interrupted.reject(failure)
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

const throwIntoMissingIterator = (error: unknown): never => {
  throw error
}

const fiberIterator = (fiber: Fiber): Iterator<unknown, unknown, unknown> => {
  if (fiber.iterator !== undefined) return fiber.iterator
  fiber.iterator = fiber.runtimeContext === undefined
    ? fiber.fx[Symbol.iterator]()
    : withActiveRuntimeContext(fiber.runtimeContext, () => fiber.fx[Symbol.iterator]())
  return fiber.iterator
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
