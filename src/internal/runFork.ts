import { Async } from '../Async'
import { is } from '../Effect'
import { Fail } from '../Fail'
import { Fork } from '../Fork'
import { Fx } from '../Fx'
import { Task } from '../Task'
import { Handler, } from './Handler'
import { HandlerContext } from './HandlerContext'
import { Semaphore } from './Semaphore'
import { DisposableSet } from './disposable'

export const runFork = <const E, const A>(f: Fx<E, A>, s: Semaphore, name?: string): Task<A, Extract<E, Fail<any>>> => {
  const disposables = new DisposableSet()

  const promise = acquire(s, disposables, () => new Promise<A>(async (resolve, reject) => {
    const i = f[Symbol.iterator]()
    disposables.add(new IteratorDisposable(i))
    let ir = i.next()

    while (!ir.done) {
      if (is(Async, ir.value)) {
        const p = runTask(ir.value.arg)
        disposables.add(p)
        const a = await p.promise
          .finally(() => disposables.remove(p))
          .catch(e => reject(new TaskError('Awaited Async effect failed', e, name)))
        // stop if the scope was disposed while we were waiting
        if (disposables.disposed) return
        ir = i.next(a)
      }
      else if (is(Fork, ir.value)) {
        const { fx, context, name } = ir.value.arg
        const p = runFork(withContext(context, fx), s, name)
        disposables.add(p)
        p.promise
          .finally(() => disposables.remove(p))
          .catch(e => reject(new TaskError('Forked subtask failed', e, name)))
        ir = i.next(p)
      }
      else if (is(Fail, ir.value)) return reject(new TaskError('Unhandled failure in forked task', ir.value.arg, name))
      else return reject(new TaskError('Unexpected effect in forked task', ir.value, name))
    }
    resolve(ir.value as A)
  }).finally(() => disposables[Symbol.dispose]()))

  return new Task(promise, disposables)
}

class TaskError extends Error {
  constructor(message: string, cause: unknown, public readonly task?: string) {
    super(task ? `[${task}] ${message}` : message, { cause })
  }
}

const acquire = <A>(s: Semaphore, scope: DisposableSet, f: () => Promise<A>) => {
  const a = s.acquire()
  scope.add(a)
  return a.promise.then(f).finally(() => {
    scope.remove(a)
    s.release()
  })
}

const runTask = <A>(run: (s: AbortSignal) => Promise<A>) => {
  const s = new AbortController()
  return new Task<A, unknown>(run(s.signal), new AbortControllerDisposable(s))
}

export const withContext = (c: readonly HandlerContext[], f: Fx<unknown, unknown>) =>
  c.reduce((f, handler) => new Handler(f, handler.handlers, new Map()), f)

class AbortControllerDisposable {
  constructor(private readonly controller: AbortController) { }
  [Symbol.dispose]() { this.controller.abort() }
}

class IteratorDisposable {
  constructor(private readonly iterator: Iterator<unknown>) { }
  [Symbol.dispose]() { this.iterator.return?.() }
}
