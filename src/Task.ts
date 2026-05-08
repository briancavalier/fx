import { Async, assertPromise } from './Async.js'

import { Fail, fail } from './Fail.js'
import { Fx, flatten, ok } from './Fx.js'
import type { RuntimeContext } from './internal/runtimeContext.js'
import { withActiveRuntimeContext } from './internal/runtimeContext.js'

export class Task<A, E> {
  private disposed = false
  public readonly E!: E

  constructor(
    public readonly promise: Promise<A>,
    private readonly dispose: Disposable,
    public readonly _runtimeContext?: RuntimeContext
  ) {
  }

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

      const p = t.promise.finally(() => s.removeEventListener('abort', dispose))
      const context = t._runtimeContext
      return context === undefined
        ? p.then(ok, fail)
        : p.then(
          a => withActiveRuntimeContext(context, () => ok(a)),
          e => withActiveRuntimeContext(context, () => fail(e))
        )
    })
  ) as Fx<Extract<E, Fail<any>> | Async, A>
