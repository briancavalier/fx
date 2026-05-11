import { Breadcrumb, at } from './Breadcrumb.js'
import { Effect, traceOriginOf } from './Effect.js'
import type { AnyEffect } from './Effect.js'
import { Fx, ok } from './Fx.js'
import { control } from './Handler.js'
import type { TraceOrigin } from './Trace.js'
import { Trace, captureTrace } from './Trace.js'

export class Fail<const E> extends Effect('fx/Fail')<E, never> {
  readonly origin: Breadcrumb
  readonly trace?: Trace

  constructor(
    e: E,
    traceOrigin: TraceOrigin = { origin: at('fx/Fail', Fail) }
  ) {
    super(e)
    this.origin = traceOrigin.origin
    this.trace = traceOrigin.trace ?? captureTrace(traceOrigin.origin, undefined, { kind: 'fail' })
  }
}

/**
 * Fail with an error e.
 */
export const fail = <const E>(
  e: E,
  origin: Breadcrumb = at('fx/Fail/fail', fail)
): Fx<Fail<E>, never> => new Fail(e, { origin })

/**
 * Fail with an error e, using an effect's diagnostic origin when available.
 */
export const failFrom = <const E>(
  effect: AnyEffect,
  e: E,
  fallback: Breadcrumb = at('fx/Fail/failFrom', failFrom)
): Fx<Fail<E>, never> => {
  const traceOrigin = traceOriginOf(effect)
  return traceOrigin === undefined
    ? new Fail(e, { origin: fallback })
    : new Fail(e, traceOrigin)
}

/**
 * Catch failures matching a type guard and handle them with the provided function.
 * @example
 *   computation.pipe(catchIf(isAuthError, e => recoverFx))
 */
export const catchIf = <const E1, const E extends ExtractFail<E1>, const E2, const B>(
  match: (e: ExtractFail<E1>) => e is E,
  handle: (e: E) => Fx<E2, B>
) => <const A>(f: Fx<E1, A>): Fx<Exclude<E1, Fail<E>> | E2, A | B> =>
    f.pipe(
      control(Fail<ExtractFail<E>>, (_, failure) =>
        (match(failure.arg) ? handle(failure.arg) : failure) as Fx<Exclude<E1, Fail<E>> | E2, A | B>)
    ) as Fx<Exclude<E1, Fail<E>> | E2, A | B>

type AnyConstructor = abstract new (...args: any[]) => any

/**
 * Catch failures that are instances of the given constructor and handles them with the provided function.
 * @example
 *   computation.pipe(catchOnly(AuthError, e => recoverFx))
 */
export const catchOnly = <const E1, const E extends AnyConstructor, const E2, const B>(
  cls: E,
  handle: (e: Extract<ExtractFail<E1>, InstanceType<E>>) => Fx<E2, B>
) =>
  catchIf(
    (e: ExtractFail<E1>): e is Extract<ExtractFail<E1>, InstanceType<E>> => e instanceof cls,
    handle
  )

/**
 * Catch all failures and handle them with the provided function.
 * @example
 *   computation.pipe(catchAll(e => recoverFx))
 */
export const catchAll = <const E1, const E2, const B>(handle: (e: ExtractFail<E1>) => Fx<E2, B>) =>
  catchIf((_: ExtractFail<E1>): _ is ExtractFail<E1> => true, handle)

/**
 * Catch failures matching a type guard and return the caught error.
 * @example
 *   const resultOrError = computation.pipe(returnIf(isNotFoundError))
 */
export const returnIf = <const E1, const E extends ExtractFail<E1>>(match: (x: ExtractFail<E1>) => x is E) =>
  catchIf(match, ok)

/**
 * Catch failures that are instances of the given constructor and return the caught error.
 * @example
 *   const resultOrNotFoundError = computation.pipe(returnOnly(NotFoundError))
 */
export const returnOnly = <const C extends AnyConstructor>(c: C) =>
  <const E, const A>(f: Fx<E, A>) => f.pipe(catchOnly(c, ok))

/**
 * Catch all failures and return the caught error.
 * @example
 *   const resultOrError = computation.pipe(returnAll)
 */
export const returnAll = <const E, const A>(f: Fx<E, A>) => f.pipe(catchAll(ok))

/**
 * Catch all failures and return them wrapped in a `Fail` instance.
 * @example
 *   const resultOrFail = computation.pipe(returnFail)
 */
export const returnFail = <const E, const A>(f: Fx<E, A>) =>
  f.pipe(control(Fail<any>, (_, failure) => ok(failure))) as Fx<Exclude<E, Fail<any>>, A | Extract<E, Fail<any>>>

/**
 * Assert that an Fx does not fail, throwing the error if it does.
 * @example
 *   const result = trySync(f).pipe(assert) // Crashes if f fails
 */
export const assert = control(Fail<any>, (_, failure) => { throw failure.arg })

type UnwrapFail<F> = F extends Fail<infer E> ? E : never
type ExtractFail<F> = UnwrapFail<Extract<F, Fail<any>>>
