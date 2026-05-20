import { Async, assertPromise } from './Async.js'
import { Fail, fail } from './Fail.js'
import { Fx, flatten, ok } from './Fx.js'
import type { RuntimeContext } from './internal/runtimeContext.js'
import { withActiveRuntimeContext } from './internal/runtimeContext.js'

export class Task<A, E> {
  private disposed = false
  private handled = false
  public readonly E!: E

  constructor(
    public readonly promise: Promise<A>,
    private readonly dispose: Disposable,
    public readonly _runtimeContext?: RuntimeContext,
    private readonly disposedPromise: Promise<void> = Promise.resolve()
  ) {
    this.disposedPromise.catch(() => { })
  }

  [Symbol.dispose]() {
    this.disposeWithReason(undefined)
  }

  private disposeWithReason(reason: unknown) {
    if (this.disposed) return
    this.disposed = true
    this.promise.catch(() => { })
    if (isReasonedDisposable(this.dispose)) this.dispose._disposeWithReason(reason)
    else this.dispose[Symbol.dispose]()
  }

  /** @internal Runtime-owned disposal helper. */
  async _disposeAndWait(reason?: unknown) {
    this.disposeWithReason(reason)
    await this.disposedPromise
  }

  /** @internal Runtime-owned unhandled fork diagnostic state. */
  get _disposed() {
    return this.disposed
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

interface ReasonedDisposable extends Disposable {
  _disposeWithReason(reason: unknown): void
}

const isReasonedDisposable = (d: Disposable): d is ReasonedDisposable =>
  '_disposeWithReason' in d

export const dispose = <const A, const E>(t: Task<A, E>) =>
  t[Symbol.dispose]()

export const wait = <const A, const E>(t: Task<A, E>) =>
  flatten(assertPromise<Fx<E | Fail<unknown>, A>>(
    s => {
      t._markHandled()
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
