import { Async, assertPromise, tryPromise } from './Async.js'
import { at } from './Breadcrumb.js'
import { Fork, firstSettled, fork, race } from './Concurrent.js'
import { Fail, catchAll, fail } from './Fail.js'
import { Fx, fx, map, ok } from './Fx.js'
import { InterruptFrom, interruptFrom } from './InterruptFrom.js'
import { Sleep, sleep } from './Time.js'
import { attachTrace, captureTrace } from './Trace.js'
import type { TraceOrigin } from './Trace.js'

/**
 * Run an Fx with a time limit, interrupting the named scope when the timeout wins.
 *
 * The interrupted scope runs its finalizers with a {@link TimeoutInterrupt}
 * reason, then re-yields the matching {@link InterruptFrom} so callers choose
 * how to recover or report the timeout.
 */
export function timeout<const Scope extends string>(
  scope: Scope,
  options: DefaultTimeoutInterruptOptions
): <const E, const A>(f: Fx<E, A>) => Fx<E | Fork | Sleep | Async | Fail<unknown> | InterruptFrom<Scope, TimeoutInterrupt>, A>
export function timeout<const Scope extends string, const Reason>(
  scope: Scope,
  options: TimeoutInterruptOptions<Reason>
): <const E, const A>(f: Fx<E, A>) => Fx<E | Fork | Sleep | Async | Fail<unknown> | InterruptFrom<Scope, Reason>, A>
export function timeout<const Scope extends string, const Reason>(
  scope: Scope,
  { ms, reason }: DefaultTimeoutInterruptOptions | TimeoutInterruptOptions<Reason>
) {
  const origin = at(`Timeout interrupted ${scope} after ${ms}ms`, timeout)
  const trace = captureTrace(origin, undefined, { kind: 'timeout' })
  return <const E, const A>(f: Fx<E, A>): Fx<E | Fork | Sleep | Async | Fail<unknown> | InterruptFrom<Scope, Reason | TimeoutInterrupt>, A> =>
    fx(function* () {
      const task = yield* fork(attempt(f as Fx<Fail<ErrorsOf<E>>, A>), { origin, trace })
      task._markHandled()
      const result = yield* race([
        assertPromise(() => task.promise as Promise<AttemptResult<ErrorsOf<E>, A>>),
        sleep(ms).pipe(map(() => ({
          type: 'timeout',
          reason: reason === undefined ? makeTimeoutInterrupt({ ms, origin, trace }) : reason({ ms, origin, trace })
        }) as const))
      ], { origin, trace }).pipe(firstSettled)

      if (result.type === 'success') return result.value
      if (result.type === 'failure') return yield* fail(result.failure)

      yield* tryPromise(() => task.interrupt(result.reason))
      return yield* interruptFrom(scope, result.reason)
    }) as Fx<E | Fork | Sleep | Async | Fail<unknown> | InterruptFrom<Scope, Reason | TimeoutInterrupt>, A>
}

export class TimeoutInterrupt extends Error {
  readonly name = 'TimeoutInterrupt'
  declare readonly code: 'FX_TIMEOUT_INTERRUPT'

  constructor(readonly ms: number, options?: ErrorOptions) {
    super(`Interrupted after ${ms}ms`, options)
    Object.defineProperty(this, 'code', {
      value: 'FX_TIMEOUT_INTERRUPT',
      enumerable: false,
      writable: false,
      configurable: true
    })
  }
}

export interface DefaultTimeoutInterruptOptions {
  readonly ms: number
  readonly reason?: undefined
}

export interface TimeoutInterruptOptions<Reason> {
  readonly ms: number
  readonly reason: (e: TimeoutExpired) => Reason
}

export interface TimeoutExpired extends TraceOrigin {
  readonly ms: number
}

export type ErrorsOf<E> = UnwrapFail<Extract<E, Fail<any>>>

const attempt = <const E, const A>(f: Fx<Fail<E>, A>): Fx<never, AttemptResult<E, A>> =>
  f.pipe(
    map(value => ({ type: 'success', value }) as const),
    catchAll(failure => ok({ type: 'failure', failure }) as Fx<never, Failure<E>>)
  ) as Fx<never, AttemptResult<E, A>>

type UnwrapFail<F> = F extends Fail<infer E> ? E : never

const makeTimeoutInterrupt = ({ ms, origin, trace }: TimeoutExpired) => {
  const error = new TimeoutInterrupt(ms, { cause: origin })
  if (trace !== undefined) attachTrace(error, trace)
  return error
}

type AttemptResult<E, A> = Success<A> | Failure<E>

interface Success<A> {
  readonly type: 'success'
  readonly value: A
}

interface Failure<E> {
  readonly type: 'failure'
  readonly failure: E
}
