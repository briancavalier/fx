import { Effect } from './Effect.js'
import { Fail, returnFail } from './Fail.js'
import { Fx, fx, ok, unit } from './Fx.js'
import { Handle } from './Handler.js'
import { Scoped, handleScoped, scoped } from './Scoped.js'

export class Retry<const E = unknown, const A = unknown> extends Effect('fx/Retry')<RetryContext<E, A>, Fx<unknown, A>> { }

export interface RetryContext<E, A> {
  readonly fx: Fx<unknown, A>
  readonly retries: number
  readonly while: (e: E, attempt: number) => boolean
}

export interface RetryOptions<E = unknown> {
  /**
   * Number of retries after the initial attempt.
   */
  readonly retries: number
  /**
   * Return true to retry a failed attempt. The attempt number is one-based,
   * where 1 is the initial attempt.
   */
  readonly while?: (e: E, attempt: number) => boolean
}

export interface DefaultRetryOptions<OE = never> {
  /**
   * Effect to run after each attempt. The attempt number is one-based.
   */
  readonly observe?: (e: RetryEvent<unknown>) => Fx<OE, void>
}

export type RetryEvent<E = unknown> = RetryFailure<E> | RetrySuccess

export interface RetryFailure<E = unknown> {
  readonly type: 'failure'
  readonly attempt: number
  readonly failure: E
  readonly retrying: boolean
}

export interface RetrySuccess {
  readonly type: 'success'
  readonly attempt: number
}

/**
 * Retry an Fx when it fails. The Fx is higher-order: handlers transform the
 * provided Fx, and the transformed Fx is evaluated at the retry call site.
 */
export const retry = <const E, const A>(
  f: Fx<E, A>,
  options: RetryOptions<ErrorsOf<E>>
): Fx<Exclude<E, Fail<any>> | Retry<ErrorsOf<E>, A> | Scoped<'fx/Retry'>, A> =>
  scoped('fx/Retry', f, fx =>
    new Retry<ErrorsOf<E>, A>({
      ...normalizeOptions(options),
      fx
    }) as Fx<Retry<ErrorsOf<E>, A>, Fx<Exclude<E, Fail<any>> | Retry<ErrorsOf<E>, A>, A>>
  )

/**
 * Handle Retry by rerunning the captured Fx until it succeeds, the retry budget
 * is exhausted, or the retry predicate rejects the failure.
 */
export const defaultRetry = <const OE = never>(options: DefaultRetryOptions<OE> = {}) =>
  <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, AnyRetry, Fail<ErrorsOfRetry<E>>> | OE, Scoped<'fx/Retry'>>, A> =>
    f.pipe(handleScoped('fx/Retry', Retry, runRetry(normalizeObserve(options)))) as Fx<Handle<Handle<E, AnyRetry, Fail<ErrorsOfRetry<E>>> | OE, Scoped<'fx/Retry'>>, A>

const runRetry = <OE>(observe: (e: RetryEvent<unknown>) => Fx<OE, void>) =>
  <const E, const A>(r: RetryContext<E, A>): Fx<never, Fx<Fail<E> | OE, A>> => ok(fx(function* () {
    let attempt = 1

    while (true) {
      const result = yield* (r.fx.pipe(returnFail) as Fx<never, A | Fail<E>>)

      if (!Fail.is(result)) {
        yield* observe({ type: 'success', attempt })
        return result
      }

      const retrying = attempt <= r.retries && r.while(result.arg, attempt)
      yield* observe({ type: 'failure', attempt, failure: result.arg, retrying })
      if (!retrying) return yield* result

      attempt += 1
    }
  }))

const normalizeOptions = <E>(options: RetryOptions<E>): Required<Pick<RetryOptions<E>, 'retries' | 'while'>> =>
  ({ retries: options.retries, while: options.while ?? (() => true) })

const normalizeObserve = <OE>(options: DefaultRetryOptions<OE>): ((e: RetryEvent<unknown>) => Fx<OE, void>) =>
  options.observe ?? (() => unit as Fx<OE, void>)

export type ErrorsOf<E> = UnwrapFail<Extract<E, Fail<any>>>
export type ErrorsOfRetry<E> = E extends Retry<infer R, any> ? R : never

type AnyRetry = Retry<any, any> | Retry<never, any>
type UnwrapFail<F> = F extends Fail<infer E> ? E : never
