import { Async } from '../Async'
import { Breadcrumb, at } from '../Breadcrumb'
import { Fail } from '../Fail'
import { Fork, ForkContext } from '../Fork'
import { Fx } from '../Fx'
import { Task } from '../Task'
import { Handler, } from './Handler'
import { GetHandlerContext, HandlerContext } from './HandlerContext'
import { Semaphore } from './Semaphore'
import { DisposableSet, dispose } from './disposable'

export type RunForkOptions = {
  readonly origin?: Breadcrumb | string
  readonly maxConcurrency?: number
}

export const runFork = <const E extends Async | Fork | Fail<unknown> | GetHandlerContext, const A>(f: Fx<E, A>, { origin = 'fx/runFork', maxConcurrency = Infinity }: RunForkOptions = {}): Task<A, Extract<E, Fail<any>>> => {
  const disposables = new DisposableSet()

  const promise = runForkInternal(f, [], new Semaphore(maxConcurrency), disposables, at(origin))
    .finally(() => dispose(disposables))

  return new Task(promise, disposables)
}

export const acquireAndRunFork = (f: ForkContext, s: Semaphore, context: readonly HandlerContext[]): Task<unknown, unknown> => {
  const disposables = new DisposableSet()

  const promise = acquire(s, disposables,
    () => runForkInternal(withContext([...f.context, ...context], f.fx), context, s, disposables, f.origin)
      .finally(() => dispose(disposables)))

  return new Task(promise, disposables)
}

const runForkInternal = <const E, const A>(
  f: Fx<E, A>,
  context: readonly HandlerContext[],
  semaphore: Semaphore,
  disposables: DisposableSet,
  origin: Breadcrumb
): Promise<A> =>
  new Promise<A>(async (resolve, reject) => {
    const i = f[Symbol.iterator]()
    disposables.add(new IteratorDisposable(i))
    let ir = i.next()

    while (!ir.done) {
      if (Async.is(ir.value)) {
        const t = runTask(ir.value.arg)
        disposables.add(t)
        const a = await t.promise
          .finally(() => disposables.remove(t))
          .catch(e => reject(new ForkError(`Awaited Async task failed`, origin, { cause: e })))
        // stop if the scope was disposed while we were waiting
        if (disposables.disposed) return
        ir = i.next(a)
      } else if (Fork.is(ir.value)) {
        const t = acquireAndRunFork(ir.value.arg, semaphore, context)
        disposables.add(t)
        t.promise
          .finally(() => disposables.remove(t))
          .catch(e => reject(new ForkError(`Unhandled failure in forked task`, origin, { cause: e })))
        ir = i.next(t)
      } else if (GetHandlerContext.is(ir.value)) {
        ir = i.next(context)
      } else if (Fail.is(ir.value))
        return reject(
          new ForkError(`Unhandled failure in forked task`, origin, { cause: ir.value.arg }))
      else
        return reject(new ForkError(`Unhandled failure in forked task`, origin, { cause: ir.value }))
    }
    resolve(ir.value as A)
  })

class ForkError extends Error {
  constructor(message: string, origin: Breadcrumb, options?: ErrorOptions) {
    super(message, options)
    Object.defineProperty(this, 'stack', { get: () => origin.stack })
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
  return new Task<A, unknown>(run(s.signal), s)
}

const withContext = (c: readonly HandlerContext[], f: Fx<unknown, unknown>) =>
  c.reduce((f, handler) => new Handler(f, handler.effectId, handler.handler), f)

class DisposableAbortController extends AbortController {
  [Symbol.dispose]() { this.abort() }
}

class IteratorDisposable {
  constructor(private readonly iterator: Iterator<unknown>) { }
  [Symbol.dispose]() { this.iterator.return?.() }
}
