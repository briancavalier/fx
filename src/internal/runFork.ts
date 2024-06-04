import { Async } from '../Async'
import { Fail } from '../Fail'
import { Fork, ForkContext } from '../Fork'
import { Fx } from '../Fx'
import { Task } from '../Task'
import { Handler, } from './Handler'
import { HandlerContext } from './HandlerContext'
import { Semaphore } from './Semaphore'
import { DisposableSet } from './disposable'

type RunForkOptions = {
  readonly name?: string
  readonly maxConcurrency?: number
}

export const runFork = <const E extends Async | Fork | Fail<unknown>, const A>(f: Fx<E, A>, o: RunForkOptions = {}): Task<A, Extract<E, Fail<any>>> => {
  const disposables = new DisposableSet()

  const promise = runForkInternal(f, new Semaphore(o.maxConcurrency ?? Infinity), disposables, o.name)
    .finally(() => disposables[Symbol.dispose]())

  return new Task(promise, disposables)
}

export const acquireAndRunFork = (f: ForkContext, s: Semaphore): Task<unknown, unknown> => {
  const disposables = new DisposableSet()

  const promise = acquire(s, disposables,
    () => runForkInternal(withContext(f.context, f.fx), s, disposables, f.name)
      .finally(() => disposables[Symbol.dispose]()))

  return new Task(promise, disposables)
}

const runForkInternal = <const E, const A>(f: Fx<E, A>, s: Semaphore, disposables: DisposableSet, name?: string): Promise<A> =>
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
          .catch(e => reject(new TaskError('Awaited Async effect failed', e, name)))
        // stop if the scope was disposed while we were waiting
        if (disposables.disposed) return
        ir = i.next(a)
      }
      else if (Fork.is(ir.value)) {
        const t = acquireAndRunFork(ir.value.arg, s)
        disposables.add(t)
        t.promise
          .finally(() => disposables.remove(t))
          .catch(reject) // subtask errors should already be wrapped in TaskError
        ir = i.next(t)
      }
      else if (Fail.is(ir.value)) return reject(ir.value.arg instanceof TaskError ? ir.value.arg : new TaskError('Unhandled failure in forked task', ir.value.arg, name))
      else return reject(new TaskError('Unexpected effect in forked task', ir.value, name))
    }
    resolve(ir.value as A)
  })

class TaskError extends Error {
  constructor(message: string, cause: unknown, public readonly task?: string) {
    super(task ? `[${task}] ${message}` : message, { cause })
  }
}

const acquire = <A>(s: Semaphore, scope: DisposableSet, f: () => Promise<A>) => {
  const a = s.acquire()
  scope.add(a)

  return a.promise.then(() => {
    scope.remove(a)
    return f()
  }).finally(() => s.release())
}

const runTask = <A>(run: (s: AbortSignal) => Promise<A>) => {
  const s = new DisposableAbortController()
  return new Task<A, unknown>(run(s.signal), s)
}

const withContext = (c: readonly HandlerContext[], f: Fx<unknown, unknown>) =>
  c.reduce((f, handler) => new Handler(f, handler.handlers, new Map()), f)

class DisposableAbortController extends AbortController {
  [Symbol.dispose]() { this.abort() }
}

class IteratorDisposable {
  constructor(private readonly iterator: Iterator<unknown>) { }
  [Symbol.dispose]() { this.iterator.return?.() }
}
