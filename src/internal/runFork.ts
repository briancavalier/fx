import { Async } from '../Async.js'
import { Breadcrumb, at } from '../Breadcrumb.js'
import { Fail } from '../Fail.js'
import { Fork, ForkContext } from '../Concurrent.js'
import { Fx } from '../Fx.js'
import { HandlerContext, Scoped, withContext } from '../Scoped.js'
import { Task } from '../Task.js'
import { Semaphore } from './Semaphore.js'
import { DisposableSet, dispose } from './disposable.js'

export type RunForkOptions = {
  readonly origin?: Breadcrumb
  readonly maxConcurrency?: number
}

export const runFork = <const E extends Async | Fork | Fail<unknown> | Scoped<string>, const A>(f: Fx<E, A>, { origin = at('fx/runFork', runFork), maxConcurrency = Infinity }: RunForkOptions = {}): Task<A, Extract<E, Fail<any>>> => {
  const disposables = new DisposableSet()

  const promise = runForkInternal(f, [], new Semaphore(maxConcurrency), disposables, origin)
    .finally(() => dispose(disposables))

  return new Task(promise, disposables)
}

export const acquireAndRunFork = (f: ForkContext, s: Semaphore, context: readonly HandlerContext[] = []): Task<unknown, unknown> => {
  const disposables = new DisposableSet()

  const promise = acquire(s, disposables,
    () => runForkInternal(withContext(context, f.fx), context, s, disposables, f.origin)
      .finally(() => dispose(disposables)))

  return new Task(promise, disposables)
}

const runForkInternal = <const E, const A>(
  f: Fx<E, A>,
  context: readonly HandlerContext[],
  semaphore: Semaphore,
  disposables: DisposableSet,
  origin: Breadcrumb
): Promise<A> => {
  let rejectUnhandled: (e: UnhandledForkError) => void = () => { }
  const unhandled = new Promise<never>((_, reject) => {
    rejectUnhandled = reject
  })
  unhandled.catch(() => { })

  return runForkLoop(f, context, semaphore, disposables, origin, unhandled, e => rejectUnhandled(new UnhandledForkError(e)))
}

const runForkLoop = async <const E, const A>(
  f: Fx<E, A>,
  context: readonly HandlerContext[],
  semaphore: Semaphore,
  disposables: DisposableSet,
  origin: Breadcrumb,
  unhandled: Promise<never>,
  rejectUnhandled: (e: unknown) => void
): Promise<A> => {
  try {
    const i = f[Symbol.iterator]()
    disposables.add(new IteratorDisposable(i))
    let ir = i.next()

    while (!ir.done) {
      if (Async.is(ir.value)) {
        const { run, origin } = ir.value.arg
        const t = runTask(run)
        disposables.add(t)
        const promise = t.promise.finally(() => disposables.remove(t))
        let a
        try {
          a = await Promise.race([promise, unhandled])
        } catch (e) {
          if (e instanceof UnhandledForkError) throw e.error
          throw new ForkError(`Awaited Async task failed`, origin, { cause: e })
        }
        // stop if the scope was disposed while we were waiting
        if (disposables.disposed) return await never()
        ir = i.next(a)
      } else if (Fork.is(ir.value)) {
        const forkOrigin = ir.value.arg.origin
        const t = acquireAndRunFork(ir.value.arg, semaphore, context)
        disposables.add(t)
        t.promise
          .finally(() => disposables.remove(t))
          .catch(e => rejectUnhandled(
            new ForkError(`Unhandled failure in forked task`, forkOrigin, { cause: e })
          ))
        ir = i.next(t)
      } else if (Scoped.is(ir.value)) {
        ir = i.next(context)
      } else if (Fail.is(ir.value))
        throw new ForkError(`Unhandled failure in forked task`, origin, { cause: ir.value.arg })
      else
        throw new ForkError(`Unhandled failure in forked task`, origin, { cause: ir.value })
    }
    return ir.value as A
  } catch (e) {
    if (e instanceof ForkError) throw e
    throw new ForkError(`Unhandled exception in forked task`, origin, { cause: e })
  }
}

class ForkError extends Error {
  constructor(message: string, origin: Breadcrumb, options?: ErrorOptions) {
    super(message, options)
    Object.defineProperty(this, 'stack', { get: () => origin.stack })
  }
}

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

const runTask = <A>(run: (s: AbortSignal) => Promise<A>) => {
  const s = new DisposableAbortController()
  try {
    return new Task<A, unknown>(run(s.signal), s)
  } catch (e) {
    s[Symbol.dispose]()
    return new Task<A, unknown>(Promise.reject(e), s)
  }
}

const never = <A>(): Promise<A> => new Promise(() => { })

class DisposableAbortController extends AbortController {
  [Symbol.dispose]() { this.abort() }
}

class IteratorDisposable {
  constructor(private readonly iterator: Iterator<unknown>) { }
  [Symbol.dispose]() { this.iterator.return?.() }
}
