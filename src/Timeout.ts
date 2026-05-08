import { Async } from './Async.js'
import { at } from './Breadcrumb.js'
import { Fork, firstSettled, race } from './Concurrent.js'
import { Effect } from './Effect.js'
import { Fail, catchAll, fail } from './Fail.js'
import { Fx, flatMap, flatten, fx, map, ok } from './Fx.js'
import { Handle } from './Handler.js'
import { Scoped, handleScoped, scoped } from './Scoped.js'
import { Sleep, sleep } from './Time.js'
import { attachTrace, captureTrace } from './Trace.js'
import type { TraceOrigin } from './Trace.js'

/**
 * A timeout effect. Programs yield {@link Timeout} values to request that a
 * computation be run with a time limit.
 */
export class Timeout<const E, const A, const TE> extends Effect('fx/Timeout')<TimeoutContext<E, A, TE>, Fx<unknown, A>> { }

/**
 * Request that an Fx be run with a timeout.
 *
 * @example
 * const result = await fetchUser.pipe(
 *   timeout({ ms: 1000 }),
 *   defaultTimeout(),
 *   defaultTime,
 *   unbounded,
 *   runPromise
 * )
 */
export function timeout(options: DefaultTimeoutOptions): <const E, const A>(f: Fx<E, A>) => Fx<Exclude<E, Fail<any>> | Timeout<ErrorsOf<E>, A, TimeoutError> | Scoped<'fx/Timeout'>, A>
export function timeout<const TE>(options: TimeoutOptions<TE>): <const E, const A>(f: Fx<E, A>) => Fx<Exclude<E, Fail<any>> | Timeout<ErrorsOf<E>, A, TE> | Scoped<'fx/Timeout'>, A>
export function timeout<const TE>({ ms, onTimeout }: DefaultTimeoutOptions | TimeoutOptions<TE>) {
  const origin = at(`Timeout requested after ${ms}ms`, timeout)
  const trace = captureTrace(origin, undefined, { kind: 'timeout' })
  return <const E, const A>(f: Fx<E, A>): Fx<Exclude<E, Fail<any>> | Timeout<ErrorsOf<E>, A, TE | TimeoutError> | Scoped<'fx/Timeout'>, A> =>
    scoped('fx/Timeout', f).pipe(
      flatMap(fx =>
        new Timeout<ErrorsOf<E>, A, TE | TimeoutError>({
          fx,
          ms,
          origin,
          trace,
          onTimeout: onTimeout ?? defaultTimeoutError
        }) as Fx<Timeout<ErrorsOf<E>, A, TE | TimeoutError>, Fx<Exclude<E, Fail<any>> | Timeout<ErrorsOf<E>, A, TE | TimeoutError>, A>>
      ),
      flatten
    )
}

/**
 * Default handler for Timeout. Runs the computation and fails if it does not
 * complete within the requested time.
 */
export const defaultTimeout = () =>
  <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, AnyTimeout, Fork | Sleep | Async | Fail<ErrorsOfTimeout<E> | TimeoutErrorOf<E>>>, Scoped<'fx/Timeout'>>, A> =>
    f.pipe(handleScoped('fx/Timeout', Timeout, runTimeout)) as Fx<Handle<Handle<E, AnyTimeout, Fork | Sleep | Async | Fail<ErrorsOfTimeout<E> | TimeoutErrorOf<E>>>, Scoped<'fx/Timeout'>>, A>

export class TimeoutError extends Error {
  readonly name = 'TimeoutError'
  declare readonly code: 'FX_TIMEOUT'

  constructor(readonly ms: number, options?: ErrorOptions) {
    super(`Timed out after ${ms}ms`, options)
    Object.defineProperty(this, 'code', {
      value: 'FX_TIMEOUT',
      enumerable: false,
      writable: false,
      configurable: true
    })
  }
}

export interface DefaultTimeoutOptions {
  readonly ms: number
  readonly onTimeout?: undefined
}

export interface TimeoutOptions<TE> {
  readonly ms: number
  readonly onTimeout: (e: TimeoutExpired) => TE
}

export interface TimeoutExpired extends TraceOrigin {
  readonly ms: number
}

export interface TimeoutContext<_E, A, TE> extends TraceOrigin {
  readonly fx: Fx<unknown, A>
  readonly ms: number
  readonly onTimeout: (e: TimeoutExpired) => TE
}

export type ErrorsOf<E> = UnwrapFail<Extract<E, Fail<any>>>
export type ErrorsOfTimeout<E> = E extends Timeout<infer R, any, any> ? R : never
export type TimeoutErrorOf<E> = E extends Timeout<any, any, infer TE> ? TE : never

const runTimeout = <const E, const A, const TE>(t: TimeoutContext<E, A, TE>): Fx<Fork | Sleep | Async, Fx<Fail<E | TE>, A>> => fx(function* () {
  const result = yield* race([
    attempt(t.fx as Fx<Fail<E>, A>),
    sleep(t.ms).pipe(map(() => ({ type: 'timeout', failure: t.onTimeout(t) } as const)))
  ], t).pipe(firstSettled)

  return result.type === 'success' ? ok(result.value) : fail(result.failure)
})

const attempt = <const E, const A>(f: Fx<Fail<E>, A>): Fx<never, TimeoutResult<E, A, never>> =>
  f.pipe(
    map(value => ({ type: 'success', value }) as const),
    catchAll(failure => ok({ type: 'failure', failure }) as Fx<never, Failure<E>>)
  ) as Fx<never, TimeoutResult<E, A, never>>

type AnyTimeout = Timeout<any, any, any> | Timeout<never, any, any>
type UnwrapFail<F> = F extends Fail<infer E> ? E : never

const defaultTimeoutError = ({ ms, origin, trace }: TimeoutExpired) => {
  const error = new TimeoutError(ms, { cause: origin })
  if (trace !== undefined) attachTrace(error, trace)
  return error
}

type TimeoutResult<E, A, TE> = Success<A> | Failure<E> | TimedOut<TE>

interface Success<A> {
  readonly type: 'success'
  readonly value: A
}

interface Failure<E> {
  readonly type: 'failure'
  readonly failure: E
}

interface TimedOut<TE> {
  readonly type: 'timeout'
  readonly failure: TE
}
