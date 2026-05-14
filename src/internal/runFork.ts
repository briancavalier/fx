import { Async } from '../Async.js'
import { Breadcrumb, at } from '../Breadcrumb.js'
import { Fail } from '../Fail.js'
import { Fork, ForkContext } from '../Concurrent.js'
import { Fx } from '../Fx.js'
import { CapturedHandler, HandlerCapture, withHandlerContext } from '../HandlerCapture.js'
import type { Interrupt } from '../Interrupt.js'
import { Task } from '../Task.js'
import { attachTrace, captureAppendTrace, capturePrependTrace, captureTrace, getTrace } from '../Trace.js'
import type { Trace, TraceFrameMetadata, TraceOptions } from '../Trace.js'
import { Semaphore } from './Semaphore.js'
import { DisposableSet } from './disposable.js'
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from './interrupt.js'
import { withInterpretedReturn } from './iteratorClose.js'
import type { RuntimeContext } from './runtimeContext.js'
import { currentRuntimeContext, getRuntimeContext, traceCapturePolicy, withActiveRuntimeContext } from './runtimeContext.js'

export type RunForkOptions = TraceOptions & {
  readonly maxConcurrency?: number
}

export const runFork = <const E extends Async | Fork | Fail<unknown> | HandlerCapture<string> | Interrupt, const A>(f: Fx<E, A>, options: RunForkOptions = {}): Task<A, Extract<E, Fail<any>>> => {
  const disposables = new InterruptState()
  const disposed = Promise.withResolvers<void>()
  const runtimeContext = currentRuntimeContext()
  const origin = options.origin ?? at('fx/runFork', runFork)
  const trace = options.trace ?? captureTraceWithContext(runtimeContext, origin, undefined, { kind: 'run' })
  const maxConcurrency = options.maxConcurrency ?? Infinity

  const promise = runForkInternal(f, [], new Semaphore(maxConcurrency), disposables, disposed, origin, trace, runtimeContext)
    .finally(() => {
      disposables.disposeActive()
      disposed.resolve()
    })

  return taskWithRuntimeContext(promise, disposables, runtimeContext, disposed.promise)
}

export const acquireAndRunFork = (f: ForkContext, s: Semaphore, context: readonly CapturedHandler[] = [], runtimeContext: RuntimeContext | undefined = currentRuntimeContext()): Task<unknown, unknown> => {
  const disposables = new InterruptState()
  const disposed = Promise.withResolvers<void>()

  const promise = acquire(s, disposables, disposed,
    () => runForkInternal(withHandlerContext(context, f.fx), context, s, disposables, disposed, f.origin, f.trace, runtimeContext)
      .finally(() => {
        disposables.disposeActive()
        disposed.resolve()
      }))

  return taskWithRuntimeContext(promise, disposables, runtimeContext, disposed.promise)
}

const runForkInternal = <const E, const A>(
  f: Fx<E, A>,
  context: readonly CapturedHandler[],
  semaphore: Semaphore,
  disposables: InterruptState,
  disposed: PromiseWithResolvers<void>,
  origin: Breadcrumb,
  trace: Trace | undefined,
  runtimeContext?: RuntimeContext
): Promise<A> => {
  return runForkLoop(f, context, semaphore, disposables, disposed, origin, trace, new UnhandledForkMonitor(), runtimeContext)
}

const runForkLoop = async <const E, const A>(
  f: Fx<E, A>,
  context: readonly CapturedHandler[],
  semaphore: Semaphore,
  disposables: InterruptState,
  disposed: PromiseWithResolvers<void>,
  origin: Breadcrumb,
  trace: Trace | undefined,
  unhandled: UnhandledForkMonitor,
  runtimeContext?: RuntimeContext
): Promise<A> => {
  let interrupting: Promise<void> | undefined

  try {
    const i = iteratorWithRuntimeContext(f, runtimeContext)
    const interrupt = async (cleanupMasks: readonly InterruptMaskBegin['arg'][] = disposables.maskSnapshot()): Promise<A> => {
      if (interrupting === undefined) {
        interrupting = closeInterruptedIterator(i, context, semaphore, origin, trace, unhandled, runtimeContext, disposed, cleanupMasks)
        interrupting.catch(() => { })
      }
      await interrupting
      return await never()
    }
    disposables.setInterrupt(interrupt)
    return await runIterator(nextWithRuntimeContext(i, runtimeContext), i, context, semaphore, disposables, origin, trace, unhandled, runtimeContext, interrupt)
  } catch (e) {
    if (e instanceof ForkError) {
      if (disposables.interruptRequested) disposed.reject(e)
      throw e
    }
    const errorContext = getRuntimeContext(e) ?? runtimeContext
    const error = new ForkError('FX_UNHANDLED_EXCEPTION', `Unhandled exception in forked task`, origin, traceWithCause(trace, e, errorContext), errorContext, { cause: e })
    if (disposables.interruptRequested) disposed.reject(error)
    throw error
  }
}

const closeInterruptedIterator = async <const E, const A>(
  i: Iterator<E, A, unknown>,
  context: readonly CapturedHandler[],
  semaphore: Semaphore,
  origin: Breadcrumb,
  trace: Trace | undefined,
  unhandled: UnhandledForkMonitor,
  runtimeContext: RuntimeContext | undefined,
  disposed: PromiseWithResolvers<void>,
  cleanupMasks: readonly InterruptMaskBegin['arg'][]
): Promise<void> => {
  const cleanup = new InterruptState(cleanupMasks)
  try {
    const ir = returnWithRuntimeContext(i, runtimeContext)
    await runIterator(ir, i, context, semaphore, cleanup, origin, trace, unhandled, runtimeContext)
    disposed.resolve()
  } catch (e) {
    disposed.reject(e)
    throw e
  } finally {
    cleanup.disposeActive()
  }
}

const runIterator = async <const E, const A>(
  ir: IteratorResult<E, A>,
  i: Iterator<E, A, unknown>,
  context: readonly CapturedHandler[],
  semaphore: Semaphore,
  disposables: InterruptState,
  origin: Breadcrumb,
  trace: Trace | undefined,
  unhandled: UnhandledForkMonitor,
  runtimeContext: RuntimeContext | undefined,
  interrupt?: (masks?: readonly InterruptMaskBegin['arg'][]) => Promise<A>
): Promise<A> => {
  while (!ir.done) {
    if (Async.is(ir.value)) {
      const effectContext = runtimeContextOfEffect(ir.value, runtimeContext)
      const { run, origin } = ir.value.arg
      const t = runTask(run, effectContext)
      disposables.add(t)
      const promise = t.promise.finally(() => disposables.remove(t))
      let a
      try {
        a = await unhandled.race(promise)
      } catch (e) {
        if (e instanceof UnhandledForkError) throw e.error
        if (disposables.canInterrupt && interrupt !== undefined) return await disposables.interruptNow(interrupt)
        const asyncTrace = capturePrependTraceWithContext(effectContext, origin, trace, { kind: 'async' })
        throw new ForkError('FX_AWAITED_ASYNC_FAILED', `Awaited Async task failed`, origin, traceWithCause(asyncTrace, e, effectContext), effectContext, { cause: e })
      }
      // stop if the scope was disposed while we were waiting
      if (disposables.canInterrupt && interrupt !== undefined) return await disposables.interruptNow(interrupt)
      ir = resumeWithRuntimeContext(i, effectContext, a)
    } else if (Fork.is(ir.value)) {
      const effectContext = runtimeContextOfEffect(ir.value, runtimeContext)
      const forkOrigin = ir.value.arg.origin
      const forkTrace = capturePrependTraceWithContext(effectContext, forkOrigin, trace, forkFrameMetadata(ir.value.arg.trace))
      unhandled.activate()
      const t = acquireAndRunFork({ ...ir.value.arg, trace: forkTrace }, semaphore, context, effectContext)
      disposables.add(t)
      t.promise
        .finally(() => disposables.remove(t))
        .catch(e => {
          queueMicrotask(() => {
            if (t._handled || t._disposed || disposables.interruptRequested) return
            unhandled.reject(
              new ForkError('FX_UNHANDLED_FORK_FAILURE', `Unhandled failure in forked task`, forkOrigin, traceWithCause(forkTrace, e, effectContext), effectContext, { cause: e })
            )
          })
        })
      ir = resumeWithRuntimeContext(i, effectContext, t)
    } else if (HandlerCapture.is(ir.value)) {
      ir = resumeWithRuntimeContext(i, runtimeContext, context)
    } else if (InterruptMaskBegin.is(ir.value)) {
      disposables.mask(ir.value.arg)
      ir = resumeWithRuntimeContext(i, runtimeContext, undefined)
    } else if (InterruptMaskEnd.is(ir.value)) {
      const masksAtInterruptDelivery = disposables.maskSnapshot()
      disposables.unmask(ir.value.arg)
      if (disposables.canInterrupt && interrupt !== undefined) return await disposables.interruptNow(interrupt, masksAtInterruptDelivery)
      ir = resumeWithRuntimeContext(i, runtimeContext, undefined)
    } else if (Fail.is(ir.value)) {
      const causeTrace = getTrace(ir.value.arg)
      const effectContext = runtimeContextOfEffect(ir.value, runtimeContext)
      const failTrace = traceUnhandledFail(ir.value, causeTrace, trace, effectContext)
      const failOrigin = originOfUnhandledFail(ir.value, causeTrace)
      throw new ForkError('FX_UNHANDLED_FAILURE', `Unhandled failure in forked task`, failOrigin, failTrace, effectContext, { cause: ir.value.arg })
    } else {
      const effectContext = runtimeContextOfEffect(ir.value, runtimeContext)
      throw new ForkError('FX_UNHANDLED_FAILURE', `Unhandled failure in forked task`, origin, traceWithCause(trace, ir.value, effectContext), effectContext, { cause: ir.value })
    }
  }
  return ir.value as A
}

class InterruptState implements Disposable {
  private readonly disposables = new DisposableSet()
  private readonly masks: InterruptMaskState
  private interrupt?: (masks?: readonly InterruptMaskBegin['arg'][]) => Promise<unknown>
  private interrupting?: Promise<unknown>
  private requested = false

  constructor(masks: readonly InterruptMaskBegin['arg'][] = []) {
    this.masks = new InterruptMaskState(masks)
  }

  get interruptRequested() {
    return this.requested
  }

  get canInterrupt() {
    return this.requested && this.masks.canInterrupt
  }

  setInterrupt(interrupt: (masks?: readonly InterruptMaskBegin['arg'][]) => Promise<unknown>) {
    this.interrupt = interrupt
    if (this.requested && this.masks.canInterrupt) void this.interruptNow(interrupt).catch(() => { })
  }

  add(disposable: Disposable) {
    this.disposables.add(disposable)
  }

  remove(disposable: Disposable) {
    this.disposables.remove(disposable)
  }

  maskSnapshot() {
    return this.masks.snapshot()
  }

  mask(token: InterruptMaskBegin['arg']) {
    this.masks.mask(token)
  }

  unmask(token: InterruptMaskEnd['arg']) {
    this.masks.unmask(token)
  }

  [Symbol.dispose]() {
    this.requested = true
    if (!this.masks.canInterrupt) return
    this.disposeActive()
    if (this.interrupt !== undefined) void this.interruptNow(this.interrupt).catch(() => { })
  }

  disposeActive() {
    this.disposables[Symbol.dispose]()
  }

  async interruptNow<A>(interrupt: (masks?: readonly InterruptMaskBegin['arg'][]) => Promise<A>, masks: readonly InterruptMaskBegin['arg'][] = this.maskSnapshot()): Promise<A> {
    this.disposeActive()
    this.interrupting ??= interrupt(masks)
    return await this.interrupting as A
  }
}

class ForkError extends Error {
  constructor(readonly code: ForkErrorCode, message: string, origin: Breadcrumb, trace: Trace | undefined, runtimeContext?: RuntimeContext, options?: ErrorOptions) {
    super(message, options)
    if (traceCapturePolicy(runtimeContext) === 'full' && 'stack' in origin) Object.defineProperty(this, 'stack', { get: () => origin.stack })
    Object.defineProperty(this, 'code', {
      value: code,
      enumerable: false,
      writable: false,
      configurable: true
    })
    if (trace !== undefined) attachTrace(this, trace)
  }
}

type ForkErrorCode = 'FX_AWAITED_ASYNC_FAILED' | 'FX_UNHANDLED_FORK_FAILURE' | 'FX_UNHANDLED_FAILURE' | 'FX_UNHANDLED_EXCEPTION'

class UnhandledForkError extends Error {
  constructor(readonly error: unknown) {
    super('Unhandled fork failed')
  }
}

class UnhandledForkMonitor {
  private promise?: Promise<never>
  private rejectPromise?: (e: UnhandledForkError) => void

  race<A>(promise: Promise<A>): Promise<A> {
    return this.promise === undefined ? promise : Promise.race([promise, this.promise])
  }

  activate() {
    this.ensureReject()
  }

  reject(e: unknown) {
    this.ensureReject()(new UnhandledForkError(e))
  }

  private ensureReject(): (e: UnhandledForkError) => void {
    if (this.rejectPromise !== undefined) return this.rejectPromise

    this.promise = new Promise<never>((_, reject) => {
      this.rejectPromise = reject
    })
    this.promise.catch(() => { })
    return this.rejectPromise!
  }
}

const acquire = async <A>(s: Semaphore, scope: InterruptState, disposed: PromiseWithResolvers<void>, f: () => Promise<A>) => {
  const a = s.acquire()
  const cancelled = Promise.withResolvers<void>()
  let acquired = false
  let released = false
  const releaseOnce = () => {
    if (released) return
    released = true
    s.release()
  }
  const acquisition = {
    [Symbol.dispose]() {
      a[Symbol.dispose]()
      cancelled.resolve()
    }
  }

  scope.add(acquisition)
  await Promise.race([
    a.promise.then(() => {
      acquired = true
    }),
    cancelled.promise
  ])
  scope.remove(acquisition)

  if (!acquired) {
    disposed.resolve()
    return await never()
  }

  const interrupted = disposed.promise.then(() => {
    releaseOnce()
    return never<A>()
  })

  try {
    return await Promise.race([f(), interrupted])
  } finally {
    releaseOnce()
  }
}

const runTask = <A>(run: (s: AbortSignal) => Promise<A>, runtimeContext?: RuntimeContext) => {
  const s = new DisposableAbortController()
  try {
    return runtimeContext === undefined
      ? new Task<A, unknown>(run(s.signal), s, runtimeContext)
      : withActiveRuntimeContext(runtimeContext, () =>
        new Task<A, unknown>(run(s.signal), s, runtimeContext)
      )
  } catch (e) {
    s[Symbol.dispose]()
    return taskWithRuntimeContext(Promise.reject(e), s, runtimeContext)
  }
}

const taskWithRuntimeContext = <A, E>(
  promise: Promise<A>,
  dispose: Disposable,
  runtimeContext?: RuntimeContext,
  disposed?: Promise<void>
): Task<A, E> =>
  runtimeContext === undefined
    ? new Task<A, E>(promise, dispose, runtimeContext, disposed)
    : withActiveRuntimeContext(runtimeContext, () => new Task<A, E>(promise, dispose, runtimeContext, disposed))

const iteratorWithRuntimeContext = <E, A>(
  f: Fx<E, A>,
  runtimeContext?: RuntimeContext
): Iterator<E, A, unknown> =>
  runtimeContext === undefined
    ? f[Symbol.iterator]()
    : withActiveRuntimeContext(runtimeContext, () => f[Symbol.iterator]())

const nextWithRuntimeContext = <E, A>(
  iterator: Iterator<E, A, unknown>,
  runtimeContext?: RuntimeContext
): IteratorResult<E, A> =>
  runtimeContext === undefined
    ? iterator.next()
    : withActiveRuntimeContext(runtimeContext, () => iterator.next())

const resumeWithRuntimeContext = <E, A>(
  iterator: Iterator<E, A, unknown>,
  runtimeContext: RuntimeContext | undefined,
  value: unknown
): IteratorResult<E, A> =>
  runtimeContext === undefined
    ? iterator.next(value)
    : withActiveRuntimeContext(runtimeContext, () => iterator.next(value))

const returnWithRuntimeContext = <E, A>(
  iterator: Iterator<E, A, unknown>,
  runtimeContext?: RuntimeContext
): IteratorResult<E, A> =>
  runtimeContext === undefined
    ? withInterpretedReturn(() => iterator.return?.() ?? { done: true, value: undefined as A })
    : withActiveRuntimeContext(runtimeContext, () =>
      withInterpretedReturn(() => iterator.return?.() ?? { done: true, value: undefined as A }))

const never = <A>(): Promise<A> => new Promise(() => { })

const traceWithCause = (trace: Trace | undefined, cause: unknown, runtimeContext?: RuntimeContext): Trace | undefined => {
  const causeTrace = getTrace(cause)
  return captureAppendTraceWithContext(runtimeContext, causeTrace ?? trace, causeTrace === undefined ? undefined : trace)
}

const runtimeContextOfEffect = (effect: unknown, fallback?: RuntimeContext): RuntimeContext | undefined =>
  getRuntimeContext(effect) ?? fallback

const traceUnhandledFail = (
  fail: Fail<unknown>,
  causeTrace: Trace | undefined,
  parentTrace: Trace | undefined,
  runtimeContext?: RuntimeContext
): Trace | undefined => {
  if (causeTrace !== undefined) return captureAppendTraceWithContext(runtimeContext, causeTrace, parentTrace)
  if (fail.trace === undefined) return captureAppendTraceWithContext(runtimeContext, undefined, parentTrace)
  return parentTrace === undefined
    ? fail.trace
    : captureAppendTraceWithContext(runtimeContext, fail.trace, parentTrace) ?? fail.trace
}

const originOfUnhandledFail = (fail: Fail<unknown>, causeTrace: Trace | undefined): Breadcrumb =>
  causeTrace === undefined ? fail.origin : originFromTrace(causeTrace)

const forkFrameMetadata = (trace: Trace | undefined): TraceFrameMetadata => ({
  kind: trace?.frame.kind ?? 'fork',
  index: trace?.frame.index
})

const captureTraceWithContext = (
  context: RuntimeContext | undefined,
  origin: Breadcrumb,
  parent?: Trace,
  metadata?: TraceFrameMetadata
): Trace | undefined =>
  context === undefined
    ? captureTrace(origin, parent, metadata)
    : withActiveRuntimeContext(context, () => captureTrace(origin, parent, metadata))

const capturePrependTraceWithContext = (
  context: RuntimeContext | undefined,
  origin: Breadcrumb,
  parent?: Trace,
  metadata?: TraceFrameMetadata
): Trace | undefined =>
  context === undefined
    ? capturePrependTrace(origin, parent, metadata)
    : withActiveRuntimeContext(context, () => capturePrependTrace(origin, parent, metadata))

const captureAppendTraceWithContext = (
  context: RuntimeContext | undefined,
  trace: Trace | undefined,
  parent?: Trace
): Trace | undefined =>
  context === undefined
    ? captureAppendTrace(trace, parent)
    : withActiveRuntimeContext(context, () => captureAppendTrace(trace, parent))

const originFromTrace = (trace: Trace): Breadcrumb => ({
  message: trace.frame.message,
  get stack() {
    return trace.frame.stackSource?.stack
  }
})

class DisposableAbortController extends AbortController {
  [Symbol.dispose]() { this.abort() }
}
