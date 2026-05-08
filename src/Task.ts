import { Async, assertPromise } from './Async.js'

import { Fail, fail } from './Fail.js'
import { Fx, flatten, ok } from './Fx.js'
import type { RuntimeContext } from './internal/runtimeContext.js'
import { currentRuntimeContext, withActiveRuntimeContext } from './internal/runtimeContext.js'

const runtimeContexts = new WeakMap<Task<any, any>, RuntimeContext>()

export class Task<A, E> {
  private disposed = false
  public readonly E!: E

  constructor(public readonly promise: Promise<A>, private readonly dispose: Disposable) {
    const context = currentRuntimeContext()
    if (context !== undefined) runtimeContexts.set(this, context)
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
      const context = runtimeContexts.get(t)
      s.addEventListener('abort', dispose)
      return t.promise
        .finally(() => s.removeEventListener('abort', dispose))
        .then(
          a => context === undefined ? ok(a) : withActiveRuntimeContext(context, () => ok(a)),
          e => context === undefined ? fail(e) : withActiveRuntimeContext(context, () => fail(e))
        )
    })
  ) as Fx<Extract<E, Fail<any>> | Async, A>
