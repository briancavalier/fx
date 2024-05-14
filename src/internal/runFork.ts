
import { Async } from '../Async'
import { is } from '../Effect'
import { Fail } from '../Fail'
import { Fx } from '../Fx'
import { Handler, } from './Handler'
import { HandlerContext } from './HandlerContext'

import { Fork } from '../Fork'
import { Task } from '../Task'
import { Semaphore } from './Semaphore'
import { DisposableSet } from './disposable'

export const runFork = <const E, const A>(f: Fx<E, A>, s: Semaphore, name = '?'): Task<A, Extract<E, Fail<any>>> => {
  const scope = new DisposableSet()

  const promise = acquire(s, scope, () => new Promise<A>(async (resolve, reject) => {
    const i = f[Symbol.iterator]()
    scope.add(new IteratorDisposable(i))
    let ir = i.next()

    while (!ir.done) {
      if (is(Async, ir.value)) {
        const p = runTask(ir.value.arg)
        scope.add(p)
        const a = await p.promise
          .finally(() => scope.remove(p))
          .catch(e => reject(new ForkError('Awaited Async effect failed', e, name)))
        // stop if the scope was disposed while we were waiting
        if (scope.disposed) return
        ir = i.next(a)
      }
      else if (is(Fork, ir.value)) {
        const { fx, context, name } = ir.value.arg
        const p = runFork(withContext(context, fx), s, name)
        scope.add(p)
        p.promise
          .finally(() => scope.remove(p))
          .catch(e => reject(new ForkError('Forked subtask failed', e, name)))
        ir = i.next(p)
      }
      else if (is(Fail, ir.value)) return reject(new ForkError('Forked task failed', ir.value.arg, name))
      else return reject(new ForkError('Unexpected effect in forked task', ir.value, name))
    }
    resolve(ir.value as A)
  }).finally(() => scope[Symbol.dispose]()))

  return new Task(promise, scope)
}

class ForkError extends Error {
  constructor(message: string, cause: unknown, public readonly task: string) {
    super(`[${task}] ${message}`, { cause })
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
