import { Async, assertPromise } from './Async'

import { Fail, fail } from './Fail'
import { Fx, flatten, ok } from './Fx'

export class Task<A, E> {
  private disposed = false
  public readonly E!: E

  constructor(public readonly promise: Promise<A>, private readonly dispose: Disposable) { }

  [Symbol.dispose]() {
    if (this.disposed) return
    this.disposed = true
    this.dispose[Symbol.dispose]()
  }
}

export const dispose = <const A, const E>(t: Task<A, E>) =>
  t[Symbol.dispose]()

type Result<P> = P extends Task<infer A, unknown> ? A : never
type Errors<P> = P extends Task<unknown, infer E> ? E : never

export const wait = <const A, const E>(t: Task<A, E>) =>
  flatten(assertPromise<Fx<E | Fail<unknown>, A>>(
    s => {
      const dispose = () => t[Symbol.dispose]()
      s.addEventListener('abort', dispose)
      return t.promise
        .finally(() => s.removeEventListener('abort', dispose))
        .then(ok, fail)
    })
  ) as Fx<Extract<E, Fail<any>> | Async, A>

export const all = <Tasks extends readonly Task<unknown, unknown>[]>(tasks: Tasks) => {
  const d = new DisposeAll(tasks)
  const p = Promise.all(tasks.map(t => t.promise)).finally(() => { d[Symbol.dispose]() })
  return new Task(p, d) as Task<{ readonly [K in keyof Tasks]: Result<Tasks[K]> }, Errors<Tasks[number]>>
}

export const race = <Tasks extends readonly Task<unknown, unknown>[]>(tasks: Tasks) => {
  const d = new DisposeAll(tasks)
  const p = Promise.race(tasks.map(t => t.promise)).finally(() => { d[Symbol.dispose]() })
  return new Task(p, d) as Task<Result<Tasks[number]>, Errors<Tasks[number]>>
}

export class DisposeAll {
  constructor(private readonly tasks: Iterable<Task<unknown, unknown>>) { }
  [Symbol.dispose]() { for (const t of this.tasks) t[Symbol.dispose]() }
}
