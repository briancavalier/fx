import { Effect } from './Effect'
import { Fx, control, ok } from './Fx'

export class Fail<const E> extends Effect('fx/Fail')<E, never> { }

/**
 * Fail with an error e.
 */
export const fail = <const E>(e: E): Fx<Fail<E>, never> => new Fail(e)

/**
 * Catch failures matching a type guard and handles them with the provided function.
 * @example
 *   computation.pipe(catchIf(isAuthError, e => recoverFx))
 */
export const catchIf = <const E1, const E extends ExtractFail<E1>, const E2, const B>(
  match: (e: ExtractFail<E1>) => e is E,
  handle: (e: E) => Fx<E2, B>
) =>
  <const A>(f: Fx<E1, A>) => f.pipe(
    control(Fail, (_, e) =>
      (match(e as ExtractFail<E1>) ? handle(e as E) : fail(e)) as Fx<Exclude<E1, Fail<E>>, A | B>
    )
  ) as Fx<Exclude<E1, Fail<E>> | E2, A | B>

type AnyConstructor = abstract new (...args: any[]) => any

/**
 * Catch failures that are instances of the given constructor and handles them with the provided function.
 * @example
 *   computation.pipe(catchOnly(AuthError, e => recoverFx))
 */
export function catchOnly<const E1, const E extends AnyConstructor, const E2, const B>(
  cls: E,
  handle: (e: Extract<ExtractFail<E1>, InstanceType<E>>) => Fx<E2, B>
): <const A>(f: Fx<E1, A>) => Fx<Exclude<E1, Fail<InstanceType<E>>> | E2, A | B> {
  return <const A>(f: Fx<E1, A>) => f.pipe(
    control(Fail, (_, e) =>
      (e instanceof cls ? handle(e) : fail(e)) as Fx<Exclude<E1, Fail<InstanceType<E>>> | E2, A | B>
    )
  ) as Fx<Exclude<E1, Fail<InstanceType<E>>> | E2, A | B>
}

/**
 * Catch all failures and handle them with the provided function.
 * @example
 *   computation.pipe(catchAll(e => recoverFx))
 */
export const catchAll = <const E1, const E2, const B>(handle: (e: ExtractFail<E1>) => Fx<E2, B>) =>
  <const A>(f: Fx<E1, A>) => f.pipe(
    control(Fail, (_, e) => handle(e as ExtractFail<E1>) as Fx<Exclude<E1, Fail<any>>, A | B>)
  ) as Fx<Exclude<E1, Fail<any>> | E2, A | B>

/**
 * Catch failures matching a type guard and return the caught error.
 * @example
 *   const resultOrError = computation.pipe(returnIf(isNotFoundError))
 */
export const returnIf = <const E1, const E extends ExtractFail<E1>>(match: (x: ExtractFail<E1>) => x is E) =>
  <const A>(f: Fx<E1, A>) => f.pipe(catchIf(match, ok))

/**
 * Catch failures that are instances of the given constructor and return the caught error.
 * @example
 *   const resultOrError = computation.pipe(returnOnly(NotFoundError))
 */
export const returnOnly = <const E1, const C extends AnyConstructor>(c: C) =>
  <const A>(f: Fx<E1, A>) => f.pipe(catchOnly(c, ok))

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
  f.pipe(
    control(Fail, (_, e) => ok(new Fail(e)))
  ) as Fx<Exclude<E, Fail<any>>, A | Extract<E, Fail<any>>>

type UnwrapFail<F> = F extends Fail<infer E> ? E : never
type ExtractFail<F> = UnwrapFail<Extract<F, Fail<any>>>
