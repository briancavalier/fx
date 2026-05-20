import { Async, assertPromise } from './Async.js'
import { Fail, fail } from './Fail.js'
import { Fx, flatten, ok } from './Fx.js'
import type { RuntimeContext } from './internal/runtimeContext.js'
import { withActiveRuntimeContext } from './internal/runtimeContext.js'

export class Task<A, E> {
  private interrupted = false
  private handled = false
  public readonly E!: E

  constructor(
    public readonly promise: Promise<A>,
    private readonly interruptTask: (reason?: unknown) => void,
    public readonly _runtimeContext?: RuntimeContext,
    private readonly interruptedPromise: Promise<void> = Promise.resolve()
  ) {
    this.interruptedPromise.catch(() => { })
  }

  async interrupt(reason?: unknown) {
    if (!this.interrupted) {
      this.interrupted = true
      this.promise.catch(() => { })
      this.interruptTask(reason)
    }
    await this.interruptedPromise
  }

  /** @internal Runtime-owned unhandled fork diagnostic state. */
  get _interrupted() {
    return this.interrupted
  }

  /** @internal Runtime-owned unhandled fork diagnostic state. */
  get _handled() {
    return this.handled
  }

  /** @internal Runtime-owned unhandled fork diagnostic state. */
  _markHandled() {
    this.handled = true
  }
}

export const wait = <const A, const E>(t: Task<A, E>) =>
  flatten(assertPromise<Fx<E | Fail<unknown>, A>>(
    s => {
      t._markHandled()
      const interrupt = () => { void t.interrupt() }
      s.addEventListener('abort', interrupt)

      const p = t.promise.finally(() => s.removeEventListener('abort', interrupt))
      const context = t._runtimeContext
      return context === undefined
        ? p.then(ok, fail)
        : p.then(
          a => withActiveRuntimeContext(context, () => ok(a)),
          e => withActiveRuntimeContext(context, () => fail(e))
        )
    })
  ) as Fx<Extract<E, Fail<any>> | Async, A>
