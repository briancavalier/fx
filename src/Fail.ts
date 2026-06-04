import { Breadcrumb, at } from './Breadcrumb.js'
import { Effect, isEffect, traceOriginOf } from './Effect.js'
import type { AnyEffect } from './Effect.js'
import { Fx, ok } from './Fx.js'
import { getRuntimeContext, withActiveRuntimeContext, withRuntimeContext } from './internal/runtimeContext.js'
import { Pipeable, pipeThis } from './internal/pipe.js'
import type { TraceOrigin } from './Trace.js'
import { Trace, captureTrace } from './Trace.js'

/**
 * Recoverable failure represented as an effect.
 *
 * Use `Fail<E>` for validation, domain, and platform-boundary failures that
 * callers can handle. Throw JavaScript exceptions only for hard crashes or
 * internal invariants.
 */
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
 * Fail with a recoverable error value.
 *
 * The returned Fx never produces a value until a failure handler recovers it.
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

export interface CatchContext<E1, E, E2, A, B> {
  readonly body: Fx<E1, A>
  readonly match: (e: unknown) => e is E
  readonly recover: (e: E, failure: Fail<E>) => Fx<E2, B>
}

/**
 * Request a local failure recovery region.
 *
 * `Catch` is a higher-order effect: its payload contains the protected body and
 * recovery computation. Use {@link runCatch} to interpret it.
 */
export class Catch<const E1, const E, const E2, const A, const B> extends Effect('fx/Fail/Catch')<
  CatchContext<E1, E, E2, A, B>,
  A | B
> {
  constructor(
    body: Fx<E1, A>,
    match: (e: unknown) => e is E,
    recover: (e: E, failure: Fail<E>) => Fx<E2, B>
  ) {
    super({ body, match, recover })
  }
}

export type RunCatchEffects<E> =
  E extends Catch<infer E1, infer E, infer E2, any, any> ? CatchEffects<E1, E, E2> : E

type CatchEffects<E1, E, E2> = Exclude<RunCatchEffects<E1>, Fail<E>> | E2
type CatchableEffects<E> = RunCatchEffects<E>
type CatchableFail<E> = ExtractFail<CatchableEffects<E>>

/**
 * Interpret higher-order {@link Catch} requests in a computation.
 */
export class CatchRunner<const E, const A> implements Fx<RunCatchEffects<E>, A>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(public readonly fx: Fx<E, A>) { }

  *[Symbol.iterator](): Iterator<RunCatchEffects<E>, A> {
    const step = function* <E1, E, E2, A, B>(
      i: Iterator<E1, A>,
      ir: IteratorResult<E1, A>,
      match: (e: unknown) => e is E,
      recover: (e: E, failure: Fail<E>) => Fx<E2, B>,
      closeOnCatch?: () => Generator<unknown, unknown, unknown>
    ): Generator<CatchEffects<E1, E, E2>, A | B, unknown> {
      const closeBody = function* (): Generator<CatchEffects<E1, E, E2>, A | B | undefined, unknown> {
        const returned = i.return?.()
        if (returned === undefined) return undefined
        return yield* step(i, returned, match, recover, closeOnCatch)
      }
      while (!ir.done) {
        if (isEffect(ir.value)) {
          const effect = ir.value
          if (Fail.is(effect) && match(effect.arg)) {
            const context = getRuntimeContext(effect)
            const recovery = context === undefined
              ? recover(effect.arg as E, effect as Fail<E>)
              : withActiveRuntimeContext(context, () => recover(effect.arg as E, effect as Fail<E>))
            const recovered = yield* (withRuntimeContext(context, runCatch(recovery)) as Fx<E2, B>)
            yield* closeBody()
            if (closeOnCatch !== undefined) {
              yield* (closeOnCatch() as Generator<CatchEffects<E1, E, E2>, unknown, unknown>)
            }
            return recovered
          }
          if (Catch.is(effect)) {
            const nested = interpretAnyCatch(effect)
            let nestedCaught = false
            const closeOuter = function* (): Generator<CatchEffects<E1, E, E2>, unknown, unknown> {
              nestedCaught = true
              return yield* closeBody()
            }
            const nestedResult = yield* step(
              nested as Iterator<unknown, unknown>,
              nested.next(),
              match as any,
              recover as any,
              closeOuter
            ) as Generator<CatchEffects<E1, E, E2>, unknown, unknown>
            if (nestedCaught) return nestedResult as A | B
            ir = i.next(nestedResult as unknown)
          } else {
            ir = i.next(yield effect as unknown as CatchEffects<E1, E, E2>)
          }
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }
      }

      return ir.value
    }
    const interpretCatch = function* <E1, E, E2, A, B>(
      effect: Catch<E1, E, E2, A, B>
    ): Generator<CatchEffects<E1, E, E2>, A | B, unknown> {
      const { body, match, recover } = effect.arg
      const context = getRuntimeContext(effect)
      const i = withRuntimeContext(context, body)[Symbol.iterator]()
      let completed = false
      const closeBody = function* (): Generator<CatchEffects<E1, E, E2>, A | B | undefined, unknown> {
        const returned = i.return?.()
        if (returned === undefined) return undefined
        return yield* step(i, returned, match, recover)
      }
      try {
        const value = yield* step(i, i.next(), match, recover)
        completed = true
        return value
      } finally {
        if (!completed) {
          yield* closeBody()
        }
      }
    }
    const interpretAnyCatch = function* (
      effect: unknown
    ): Generator<unknown, unknown, unknown> {
      return yield* interpretCatch(effect as Catch<any, any, any, any, any>)
    }

    const i = this.fx[Symbol.iterator]()
    let completed = false
    const runStep = function* (ir: IteratorResult<E, A>): Generator<RunCatchEffects<E>, A, unknown> {
      while (!ir.done) {
        if (isEffect(ir.value)) {
          const effect = ir.value
          ir = i.next(Catch.is(effect)
            ? (yield* interpretAnyCatch(effect) as Generator<RunCatchEffects<E>, unknown, unknown>) as unknown
            : yield effect as RunCatchEffects<E>)
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }
      }

      return ir.value
    }
    const close = function* (): Generator<RunCatchEffects<E>, A | undefined, unknown> {
      const returned = i.return?.()
      if (returned === undefined) return undefined
      return yield* runStep(returned)
    }
    try {
      const value = yield* runStep(i.next())
      completed = true
      return value
    } finally {
      if (!completed) {
        yield* close()
      }
    }
  }
}

export function runCatch<const E1, const E, const E2, const A, const B>(
  fx: Catch<E1, E, E2, A, B>
): Fx<CatchEffects<E1, E, E2>, A | B>
export function runCatch<const E, const A>(fx: Fx<E, A>): Fx<RunCatchEffects<E>, A>
export function runCatch(fx: Fx<unknown, unknown>): Fx<unknown, unknown> {
  return new CatchRunner(fx)
}

/**
 * Catch failures matching a type guard and handle them with the provided function.
 * @example
 *   computation.pipe(catchIf(isAuthError, e => recoverFx))
 */
export const catchIf = <const E1, const E extends CatchableFail<E1>, const E2, const B>(
  match: (e: CatchableFail<E1>) => e is E,
  handle: (e: E) => Fx<E2, B>
) => <const A>(f: Fx<E1, A>): Fx<Exclude<CatchableEffects<E1>, Fail<E>> | E2, A | B> =>
    runCatch(new Catch(f, match as (e: unknown) => e is E, handle))

type AnyConstructor = abstract new (...args: any[]) => any

/**
 * Catch failures that are instances of the given constructor and handles them with the provided function.
 * @example
 *   computation.pipe(catchOnly(AuthError, e => recoverFx))
 */
export const catchOnly = <const E1, const E extends AnyConstructor, const E2, const B>(
  cls: E,
  handle: (e: Extract<CatchableFail<E1>, InstanceType<E>>) => Fx<E2, B>
) =>
  catchIf(
    (e: CatchableFail<E1>): e is Extract<CatchableFail<E1>, InstanceType<E>> => e instanceof cls,
    handle
  )

/**
 * Catch all failures and handle them with the provided function.
 *
 * @example
 * ```ts
 * computation.pipe(catchAll(error => recover(error)))
 * ```
 */
export const catchAll = <const E1, const E2, const B>(handle: (e: CatchableFail<E1>) => Fx<E2, B>) =>
  catchIf((_: CatchableFail<E1>): _ is CatchableFail<E1> => true, handle)

/**
 * Catch failures matching a type guard and return the caught error.
 * @example
 *   const resultOrError = computation.pipe(returnIf(isNotFoundError))
 */
export const returnIf = <const E1, const E extends CatchableFail<E1>>(match: (x: CatchableFail<E1>) => x is E) =>
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
  runCatch(new Catch(f, (_): _ is CatchableFail<E> => true, (_, failure) => ok(failure))) as Fx<Exclude<CatchableEffects<E>, Fail<any>>, A | Extract<CatchableEffects<E>, Fail<any>>>

/**
 * Assert that an Fx does not fail, throwing the error if it does.
 * @example
 *   const result = trySync(f).pipe(assert) // Crashes if f fails
 */
export const assert = <const E, const A>(f: Fx<E, A>) =>
  runCatch(new Catch(f, (_): _ is CatchableFail<E> => true, e => { throw e })) as Fx<Exclude<CatchableEffects<E>, Fail<any>>, A>

type UnwrapFail<F> = F extends Fail<infer E> ? E : never
type ExtractFail<F> = UnwrapFail<Extract<F, Fail<any>>>
