import { Async, promise } from './Async'

import { Fail, fail } from './Fail'
import { Fx, flatMap, ok } from './Fx'

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

export const toPromise = <A, E>(t: Task<A, E>): Promise<A> => t.promise

export const wait = <const A, const E>(t: Task<A, E>): Fx<Extract<E, Fail<any>> | Async, A> =>
  promise<Fx<Extract<E, Fail<any>>, A>>(
    s => new Promise(resolve => void t.promise.then(
      a => { s.aborted || resolve(ok(a)) },
      e => { s.aborted || resolve(fail(e) as any) }
    ))).pipe(flatMap(r => r))

type Result<P> = P extends Task<infer A, unknown> ? A : never
type Errors<P> = P extends Task<unknown, infer E> ? E : never

export const all = <Tasks extends readonly Task<unknown, unknown>[]>(tasks: Tasks) => {
  const dispose = new DisposeAll(tasks)
  return new Task(
    Promise.all(tasks.map(p => p.promise)).finally(() => { dispose[Symbol.dispose]() }),
    dispose
  ) as Task<{ readonly [K in keyof Tasks]: Result<Tasks[K]> }, Errors<Tasks[number]>>
}

export const race = <Tasks extends readonly Task<unknown, unknown>[]>(tasks: Tasks) => {
  const dispose = new DisposeAll(tasks)
  return new Task(
    Promise.race(tasks.map(p => p.promise)).finally(() => { dispose[Symbol.dispose]() }),
    dispose
  ) as Task<Result<Tasks[number]>, Errors<Tasks[number]>>
}

export class DisposeAll {
  constructor(private readonly tasks: Iterable<Task<unknown, unknown>>) { }
  [Symbol.dispose]() { for (const t of this.tasks) t[Symbol.dispose]() }
}
