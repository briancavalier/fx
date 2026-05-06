import { Async, assertPromise } from './Async.js'

import { Fail, fail } from './Fail.js'
import { Fx, flatten, ok } from './Fx.js'

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
