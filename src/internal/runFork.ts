import { Async } from '../Async.js'
import { Breadcrumb, at } from '../Breadcrumb.js'
import { Fail } from '../Fail.js'
import { Fx } from '../Fx.js'
import { CapturedHandler, HandlerCapture, withHandlerContext } from '../HandlerCapture.js'
import type { Interrupt } from '../Interrupt.js'
import { Task } from '../Task.js'
import { getTrace } from '../Trace.js'
import type { Trace, TraceOptions } from '../Trace.js'
import { Fork } from './concurrent/effects.js'
import type { ForkContext } from './concurrent/effects.js'
import { Semaphore } from './Semaphore.js'
import { DisposableSet } from './disposable.js'
import { ForkError, capturePrependTraceWithContext, captureTraceWithContext, forkFrameMetadata, originOfUnhandledFail, runtimeContextOfEffect, traceUnhandledFail, traceWithCause } from './forkDiagnostics.js'
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from './interrupt.js'
import { withInterpretedReturn } from './iteratorClose.js'
import type { RuntimeContext } from './runtimeContext.js'
import { currentRuntimeContext, getRuntimeContext, withActiveRuntimeContext, withInterruptionReason } from './runtimeContext.js'

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
      disposables.interruptActive()
      disposed.resolve()
    })

  return taskWithRuntimeContext(promise, reason => disposables.interrupt(reason), runtimeContext, disposed.promise)
}

export const acquireAndRunFork = (f: ForkContext, s: Semaphore, context: readonly CapturedHandler[] = [], runtimeContext: RuntimeContext | undefined = currentRuntimeContext()): Task<unknown, unknown> => {
  const disposables = new InterruptState()
  const disposed = Promise.withResolvers<void>()

  const promise = acquire(s, disposables, disposed,
    () => runForkInternal(withHandlerContext(context, f.fx), context, s, disposables, disposed, f.origin, f.trace, runtimeContext)
      .finally(() => {
        disposables.interruptActive()
        disposed.resolve()
      }))

  return taskWithRuntimeContext(promise, reason => disposables.interrupt(reason), runtimeContext, disposed.promise)
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
  let rejectUnhandled: (e: UnhandledForkError) => void = () => { }
  const unhandled = new Promise<never>((_, reject) => {
    rejectUnhandled = reject
  })
  unhandled.catch(() => { })

  return runForkLoop(f, context, semaphore, disposables, disposed, origin, trace, unhandled, e => rejectUnhandled(new UnhandledForkError(e)), runtimeContext)
}

const runForkLoop = async <const E, const A>(
  f: Fx<E, A>,
  context: readonly CapturedHandler[],
  semaphore: Semaphore,
  disposables: InterruptState,
  disposed: PromiseWithResolvers<void>,
  origin: Breadcrumb,
  trace: Trace | undefined,
  unhandled: Promise<never>,
  rejectUnhandled: (e: unknown) => void,
  runtimeContext?: RuntimeContext
): Promise<A> => {
  let interrupting: Promise<void> | undefined

  try {
    const i = iteratorWithRuntimeContext(f, runtimeContext)
    const interrupt = async (
      cleanupMasks: readonly InterruptMaskBegin['arg'][] = disposables.maskSnapshot(),
      reason: unknown = disposables.interruptionReason
    ): Promise<A> => {
      if (interrupting === undefined) {
        interrupting = closeInterruptedIterator(i, context, semaphore, origin, trace, unhandled, rejectUnhandled, runtimeContext, disposed, cleanupMasks, reason)
        interrupting.catch(() => { })
      }
      await interrupting
      return await never()
    }
    disposables.setInterrupt(interrupt)
    return await runIterator(nextWithRuntimeContext(i, runtimeContext), i, context, semaphore, disposables, origin, trace, unhandled, rejectUnhandled, runtimeContext, interrupt)
  } catch (e) {
    if (e instanceof ForkError) {
      if (disposables.interruptRequested) disposed.reject(e)
      throw e
    }
    const errorContext = getRuntimeContext(e) ?? runtimeContext
    const error = new ForkError('FX_UNHANDLED_EXCEPTION', `Unhandled exception in forked task`, origin, traceWithCause(trace, e, errorContext, getTrace(e)), errorContext, { cause: e })
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
  unhandled: Promise<never>,
  rejectUnhandled: (e: unknown) => void,
  runtimeContext: RuntimeContext | undefined,
  disposed: PromiseWithResolvers<void>,
  cleanupMasks: readonly InterruptMaskBegin['arg'][],
  reason: unknown
): Promise<void> => {
  const cleanup = new InterruptState(cleanupMasks)
  const cleanupContext = withInterruptionReason(runtimeContext, reason)
  try {
    const ir = returnWithRuntimeContext(i, cleanupContext)
    await runIterator(ir, i, context, semaphore, cleanup, origin, trace, unhandled, rejectUnhandled, cleanupContext)
    disposed.resolve()
  } catch (e) {
    disposed.reject(e)
    throw e
  } finally {
    cleanup.interruptActive()
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
  unhandled: Promise<never>,
  rejectUnhandled: (e: unknown) => void,
  runtimeContext: RuntimeContext | undefined,
  interrupt?: (masks?: readonly InterruptMaskBegin['arg'][], reason?: unknown) => Promise<A>
): Promise<A> => {
  while (!ir.done) {
    if (Async.is(ir.value)) {
      const effectContext = runtimeContextOfEffect(ir.value, runtimeContext)
      const { run, origin } = ir.value.arg
      const t = runTask(run, effectContext)
      disposables.addTask(t)
      const promise = t.promise.finally(() => disposables.removeTask(t))
      let a
      try {
        a = await Promise.race([promise, unhandled])
      } catch (e) {
        if (e instanceof UnhandledForkError) throw e.error
        if (disposables.canInterrupt && interrupt !== undefined) return await disposables.interruptNow(interrupt)
        const asyncTrace = capturePrependTraceWithContext(effectContext, origin, trace, { kind: 'async' })
        throw new ForkError('FX_AWAITED_ASYNC_FAILED', `Awaited Async task failed`, origin, traceWithCause(asyncTrace, e, effectContext, getTrace(e)), effectContext, { cause: e })
      }
      // stop if the scope was interrupted while we were waiting
      if (disposables.canInterrupt && interrupt !== undefined) return await disposables.interruptNow(interrupt)
      ir = resumeWithRuntimeContext(i, effectContext, a)
    } else if (Fork.is(ir.value)) {
      const effectContext = runtimeContextOfEffect(ir.value, runtimeContext)
      const forkOrigin = ir.value.arg.origin
      const forkTrace = capturePrependTraceWithContext(effectContext, forkOrigin, trace, forkFrameMetadata(ir.value.arg.trace))
      const t = acquireAndRunFork({ ...ir.value.arg, trace: forkTrace }, semaphore, context, effectContext)
      disposables.addTask(t)
      t.promise
        .finally(() => disposables.removeTask(t))
        .catch(e => {
          queueMicrotask(() => {
            if (t._handled || t._interrupted || disposables.interruptRequested) return
            rejectUnhandled(
              new ForkError('FX_UNHANDLED_FORK_FAILURE', `Unhandled failure in forked task`, forkOrigin, traceWithCause(forkTrace, e, effectContext, getTrace(e)), effectContext, { cause: e })
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
      throw new ForkError('FX_UNHANDLED_FAILURE', `Unhandled failure in forked task`, origin, traceWithCause(trace, ir.value, effectContext, getTrace(ir.value)), effectContext, { cause: ir.value })
    }
  }
  return ir.value as A
}

class InterruptState {
  private readonly disposables = new DisposableSet()
  private readonly tasks = new Set<Task<unknown, unknown>>()
  private readonly masks: InterruptMaskState
  private interruptHandler?: (masks?: readonly InterruptMaskBegin['arg'][], reason?: unknown) => Promise<unknown>
  private interrupting?: Promise<unknown>
  private requested = false
  private reason: unknown

  constructor(masks: readonly InterruptMaskBegin['arg'][] = []) {
    this.masks = new InterruptMaskState(masks)
  }

  get interruptRequested() {
    return this.requested
  }

  get interruptionReason() {
    return this.reason
  }

  get canInterrupt() {
    return this.requested && this.masks.canInterrupt
  }

  setInterrupt(interrupt: (masks?: readonly InterruptMaskBegin['arg'][], reason?: unknown) => Promise<unknown>) {
    this.interruptHandler = interrupt
    if (this.requested && this.masks.canInterrupt) void this.interruptNow(interrupt).catch(() => { })
  }

  add(disposable: Disposable) {
    this.disposables.add(disposable)
  }

  remove(disposable: Disposable) {
    this.disposables.remove(disposable)
  }

  addTask(task: Task<unknown, unknown>) {
    this.tasks.add(task)
  }

  removeTask(task: Task<unknown, unknown>) {
    this.tasks.delete(task)
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

  interrupt(reason?: unknown) {
    this.requested = true
    this.reason = reason
    if (!this.masks.canInterrupt) return
    this.interruptActive()
    if (this.interruptHandler !== undefined) void this.interruptNow(this.interruptHandler).catch(() => { })
  }

  interruptActive() {
    this.disposables[Symbol.dispose]()
    this.interruptActiveTasks()
  }

  async interruptNow<A>(
    interrupt: (masks?: readonly InterruptMaskBegin['arg'][], reason?: unknown) => Promise<A>,
    masks: readonly InterruptMaskBegin['arg'][] = this.maskSnapshot()
  ): Promise<A> {
    this.interruptActive()
    this.interrupting ??= interrupt(masks, this.reason)
    return await this.interrupting as A
  }

  private interruptActiveTasks() {
    for (const task of this.tasks) void task.interrupt(this.reason).catch(() => { })
  }
}

class UnhandledForkError extends Error {
  constructor(readonly error: unknown) {
    super('Unhandled fork failed')
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
      ? new Task<A, unknown>(run(s.signal), reason => s.abort(reason), runtimeContext)
      : withActiveRuntimeContext(runtimeContext, () =>
        new Task<A, unknown>(run(s.signal), reason => s.abort(reason), runtimeContext)
      )
  } catch (e) {
    s[Symbol.dispose]()
    return taskWithRuntimeContext(Promise.reject(e), reason => s.abort(reason), runtimeContext)
  }
}

const taskWithRuntimeContext = <A, E>(
  promise: Promise<A>,
  interruptTask: (reason?: unknown) => void,
  runtimeContext?: RuntimeContext,
  interrupted?: Promise<void>
): Task<A, E> =>
  runtimeContext === undefined
    ? new Task<A, E>(promise, interruptTask, runtimeContext, interrupted)
    : withActiveRuntimeContext(runtimeContext, () => new Task<A, E>(promise, interruptTask, runtimeContext, interrupted))

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

class DisposableAbortController extends AbortController {
  [Symbol.dispose]() { this.abort() }
}
