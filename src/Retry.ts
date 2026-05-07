import { at } from './Breadcrumb.js'
import { Effect } from './Effect.js'
import { Fail, returnFail } from './Fail.js'
import { flatMap, flatten, Fx, fx, ok, unit } from './Fx.js'
import { Handle } from './Handler.js'
import { Scoped, handleScoped, scoped } from './Scoped.js'
import { Trace, attachTrace, traceFrom } from './Trace.js'

/**
 * A retry effect. Programs yield {@link Retry} values to request that a
 * computation be retried when it fails.
 */
export class Retry<const E, const A> extends Effect('fx/Retry')<RetryContext<E, A>, Fx<unknown, A>> { }

/**
 * Request that an Fx be retried when it fails.
 */
export const retry = <const RE>(options: RetryOptions<RE>) =>
  <const E, const A>(f: Fx<E, A>): Fx<Exclude<E, Fail<any>> | Retry<ErrorsOf<E>, A> | Scoped<'fx/Retry'>, A> => {
    const origin = at('fx/Retry/retry', retry)
    const trace = traceFrom(origin)

    return scoped('fx/Retry', f).pipe(
      flatMap(fx =>
        new Retry<ErrorsOf<E>, A>({
          ...normalizeOptions(options as RetryOptions<ErrorsOf<E>>),
          fx,
          trace
        }) as Fx<Retry<ErrorsOf<E>, A>, Fx<Exclude<E, Fail<any>> | Retry<ErrorsOf<E>, A>, A>>
      ),
      flatten
    )
  }

/**
 * Handle Retry by rerunning the captured Fx until it succeeds, the retry budget
 * is exhausted, or the retry predicate rejects the failure.
 */
export const defaultRetry = <const OE = never>(options: DefaultRetryOptions<OE> = {}) =>
  <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, AnyRetry, Fail<ErrorsOfRetry<E>>> | OE, Scoped<'fx/Retry'>>, A> =>
    f.pipe(handleScoped('fx/Retry', Retry, runRetry(normalizeObserve(options)))) as Fx<Handle<Handle<E, AnyRetry, Fail<ErrorsOfRetry<E>>> | OE, Scoped<'fx/Retry'>>, A>

export interface RetryOptions<E> {
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
  readonly observe?: (e: RetryEvent) => Fx<OE, void>
}

export interface RetryContext<E, A> {
  readonly fx: Fx<unknown, A>
  readonly retries: number
  readonly while: (e: E, attempt: number) => boolean
  readonly trace: Trace
}

export type RetryEvent = RetryFailure | RetrySuccess

export interface RetryFailure {
  readonly type: 'failure'
  readonly attempt: number
  readonly failure: unknown
  readonly retrying: boolean
}

export interface RetrySuccess {
  readonly type: 'success'
  readonly attempt: number
}

export type ErrorsOf<E> = UnwrapFail<Extract<E, Fail<any>>>
export type ErrorsOfRetry<E> = E extends Retry<infer R, any> ? R : never

const runRetry = <OE>(observe: (e: RetryEvent) => Fx<OE, void>) =>
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
      if (!retrying) {
        if (typeof result.arg === 'object' && result.arg !== null) attachTrace(result.arg, r.trace)
        return yield* result
      }

      attempt += 1
    }
  }))

const normalizeOptions = <E>(options: RetryOptions<E>): Required<Pick<RetryOptions<E>, 'retries' | 'while'>> =>
  ({ retries: options.retries, while: options.while ?? (() => true) })

const normalizeObserve = <OE>(options: DefaultRetryOptions<OE>): ((e: RetryEvent) => Fx<OE, void>) =>
  options.observe ?? (() => unit as Fx<OE, void>)

type AnyRetry = Retry<any, any> | Retry<never, any>
type UnwrapFail<F> = F extends Fail<infer E> ? E : never
