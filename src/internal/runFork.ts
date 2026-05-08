import { Async } from '../Async.js'
import { Breadcrumb, at } from '../Breadcrumb.js'
import { Fail } from '../Fail.js'
import { Fork, ForkContext } from '../Concurrent.js'
import { Fx } from '../Fx.js'
import { HandlerContext, Scoped, withContext } from '../Scoped.js'
import { Task } from '../Task.js'
import { Trace, attachTrace, getTrace } from '../Trace.js'
import { Semaphore } from './Semaphore.js'
import { DisposableSet, dispose } from './disposable.js'
import type { RuntimeContext } from './runtimeContext.js'
import { currentRuntimeContext, getRuntimeContext, traceCapturePolicy, withActiveRuntimeContext } from './runtimeContext.js'
import { captureAppendTraceWith, capturePrependTraceWith, captureTraceWith } from './traceCapture.js'

export type RunForkOptions = {
  readonly origin?: Breadcrumb
  readonly trace?: Trace
  readonly maxConcurrency?: number
}

export const runFork = <const E extends Async | Fork | Fail<unknown> | Scoped<string>, const A>(f: Fx<E, A>, { origin = at('fx/runFork', runFork), trace = captureTraceWith(currentRuntimeContext(), origin, undefined, { kind: 'run' }), maxConcurrency = Infinity }: RunForkOptions = {}): Task<A, Extract<E, Fail<any>>> => {
  const disposables = new DisposableSet()
  const runtimeContext = currentRuntimeContext()

  const promise = runForkInternal(f, [], new Semaphore(maxConcurrency), disposables, origin, trace, runtimeContext)
    .finally(() => dispose(disposables))

  return taskWithRuntimeContext(promise, disposables, runtimeContext)
}

export const acquireAndRunFork = (f: ForkContext, s: Semaphore, context: readonly HandlerContext[] = [], runtimeContext: RuntimeContext | undefined = currentRuntimeContext()): Task<unknown, unknown> => {
  const disposables = new DisposableSet()

  const promise = acquire(s, disposables,
    () => runForkInternal(withContext(context, f.fx), context, s, disposables, f.origin, f.trace, runtimeContext)
      .finally(() => dispose(disposables)))

  return taskWithRuntimeContext(promise, disposables, runtimeContext)
}

const runForkInternal = <const E, const A>(
  f: Fx<E, A>,
  context: readonly HandlerContext[],
  semaphore: Semaphore,
  disposables: DisposableSet,
  origin: Breadcrumb,
  trace: Trace | undefined,
  runtimeContext?: RuntimeContext
): Promise<A> => {
  let rejectUnhandled: (e: UnhandledForkError) => void = () => { }
  const unhandled = new Promise<never>((_, reject) => {
    rejectUnhandled = reject
  })
  unhandled.catch(() => { })

  return runForkLoop(f, context, semaphore, disposables, origin, trace, unhandled, e => rejectUnhandled(new UnhandledForkError(e)), runtimeContext)
}

const runForkLoop = async <const E, const A>(
  f: Fx<E, A>,
  context: readonly HandlerContext[],
  semaphore: Semaphore,
  disposables: DisposableSet,
  origin: Breadcrumb,
  trace: Trace | undefined,
  unhandled: Promise<never>,
  rejectUnhandled: (e: unknown) => void,
  runtimeContext?: RuntimeContext
): Promise<A> => {
  try {
    const i = iteratorWithRuntimeContext(f, runtimeContext)
    disposables.add(new IteratorDisposable(i))
    let ir = nextWithRuntimeContext(i, runtimeContext)

    while (!ir.done) {
      if (Async.is(ir.value)) {
        const effectContext = getRuntimeContext(ir.value) ?? runtimeContext
        const { run, origin } = ir.value.arg
        const t = runTask(run, effectContext)
        disposables.add(t)
        const promise = t.promise.finally(() => disposables.remove(t))
        let a
        try {
          a = await Promise.race([promise, unhandled])
        } catch (e) {
          if (e instanceof UnhandledForkError) throw e.error
          const asyncTrace = capturePrependTraceWith(effectContext, origin, trace, { kind: 'async' })
          throw new ForkError('FX_AWAITED_ASYNC_FAILED', `Awaited Async task failed`, origin, traceWithCause(asyncTrace, e, effectContext), effectContext, { cause: e })
        }
        // stop if the scope was disposed while we were waiting
        if (disposables.disposed) return await never()
        ir = resumeWithRuntimeContext(i, effectContext, a)
      } else if (Fork.is(ir.value)) {
        const effectContext = getRuntimeContext(ir.value) ?? runtimeContext
        const forkOrigin = ir.value.arg.origin
        const forkTrace = capturePrependTraceWith(effectContext, forkOrigin, trace, {
          kind: ir.value.arg.trace?.frame.kind ?? 'fork',
          index: ir.value.arg.trace?.frame.index
        })
        const t = acquireAndRunFork({ ...ir.value.arg, trace: forkTrace }, semaphore, context, effectContext)
        disposables.add(t)
        t.promise
          .finally(() => disposables.remove(t))
          .catch(e => rejectUnhandled(
            new ForkError('FX_UNHANDLED_FORK_FAILURE', `Unhandled failure in forked task`, forkOrigin, traceWithCause(forkTrace, e, effectContext), effectContext, { cause: e })
          ))
        ir = resumeWithRuntimeContext(i, effectContext, t)
      } else if (Scoped.is(ir.value)) {
        ir = resumeWithRuntimeContext(i, runtimeContext, context)
      } else if (Fail.is(ir.value)) {
        const effectContext = getRuntimeContext(ir.value) ?? runtimeContext
        const causeTrace = getTrace(ir.value.arg)
        const failTrace = causeTrace !== undefined
          ? captureAppendTraceWith(effectContext, causeTrace, trace)
          : ir.value.trace === undefined
            ? captureAppendTraceWith(effectContext, undefined, trace)
            : trace === undefined ? ir.value.trace : captureAppendTraceWith(effectContext, ir.value.trace, trace) ?? ir.value.trace
        const failOrigin = causeTrace === undefined ? ir.value.origin : originFromTrace(causeTrace)
        throw new ForkError('FX_UNHANDLED_FAILURE', `Unhandled failure in forked task`, failOrigin, failTrace, effectContext, { cause: ir.value.arg })
      }
      else {
        const effectContext = getRuntimeContext(ir.value) ?? runtimeContext
        throw new ForkError('FX_UNHANDLED_FAILURE', `Unhandled failure in forked task`, origin, traceWithCause(trace, ir.value, effectContext), effectContext, { cause: ir.value })
      }
    }
    return ir.value as A
  } catch (e) {
    if (e instanceof ForkError) throw e
    const errorContext = getRuntimeContext(e) ?? runtimeContext
    throw new ForkError('FX_UNHANDLED_EXCEPTION', `Unhandled exception in forked task`, origin, traceWithCause(trace, e, errorContext), errorContext, { cause: e })
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

const acquire = async <A>(s: Semaphore, scope: DisposableSet, f: () => Promise<A>) => {
  const a = s.acquire()

  try {
    scope.add(a)
    await a.promise
    scope.remove(a)
    return await f()
  } finally {
    s.release()
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
  runtimeContext?: RuntimeContext
): Task<A, E> =>
  runtimeContext === undefined
    ? new Task<A, E>(promise, dispose, runtimeContext)
    : withActiveRuntimeContext(runtimeContext, () => new Task<A, E>(promise, dispose, runtimeContext))

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

const never = <A>(): Promise<A> => new Promise(() => { })

const traceWithCause = (trace: Trace | undefined, cause: unknown, runtimeContext?: RuntimeContext): Trace | undefined => {
  const causeTrace = getTrace(cause)
  return captureAppendTraceWith(runtimeContext, causeTrace ?? trace, causeTrace === undefined ? undefined : trace)
}

const originFromTrace = (trace: Trace): Breadcrumb => ({
  message: trace.frame.message,
  get stack() {
    return trace.frame.stackSource?.stack
  }
})

class DisposableAbortController extends AbortController {
  [Symbol.dispose]() { this.abort() }
}

class IteratorDisposable {
  constructor(private readonly iterator: Iterator<unknown>) { }
  [Symbol.dispose]() { this.iterator.return?.() }
}
