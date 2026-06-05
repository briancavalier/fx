import { Breadcrumb, at } from './Breadcrumb.js'
import { Effect, isEffect, traceOriginOf } from './Effect.js'
import type { AnyEffect } from './Effect.js'
import { Fx, flatten, ok } from './Fx.js'
import { handle } from './Handler.js'
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

export interface CatchContext<E1, E extends ExtractFail<E1>, E2, A, B> {
  readonly body: Fx<E1, A>
  readonly match: (e: ExtractFail<E1>) => e is E
  readonly recover: (e: E, failure: Fail<E>) => Fx<E2, B>
}

/**
 * Request a local failure recovery region.
 *
 * `Catch` is a higher-order effect: its payload contains the protected body and
 * recovery computation. Use {@link runCatch} to interpret it.
 */
export class Catch<const E1, const E extends ExtractFail<E1>, const E2, const A, const B> extends Effect('fx/Fail/Catch')<
  CatchContext<E1, E, E2, A, B>,
  Fx<CatchEffects<E1, E, E2>, A | B>
> {
  constructor(
    body: Fx<E1, A>,
    match: (e: ExtractFail<E1>) => e is E,
    recover: (e: E, failure: Fail<E>) => Fx<E2, B>
  ) {
    super({ body, match, recover })
  }
}

export type CatchEffects<E1, E, E2> = Exclude<E1, Fail<E>> | E2

/**
 * Interpret higher-order {@link Catch} requests in a computation.
 */
class CatchRegion<const E1, const E extends ExtractFail<E1>, const E2, const A, const B> implements Fx<CatchEffects<E1, E, E2>, A | B>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly body: Fx<E1, A>,
    public readonly match: (e: ExtractFail<E1>) => e is E,
    public readonly recover: (e: E, failure: Fail<E>) => Fx<E2, B>
  ) { }

  *[Symbol.iterator](): Iterator<CatchEffects<E1, E, E2>, A | B> {
    const { body, match, recover } = this
    const i = body[Symbol.iterator]()
    let completed = false
    const drainClose = function* (): Generator<CatchEffects<E1, E, E2>, unknown, unknown> {
      const returned = i.return?.()
      if (returned === undefined) return undefined
      let ir = returned
      while (!ir.done) {
        if (!isEffect(ir.value)) throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        ir = i.next(yield ir.value as CatchEffects<E1, E, E2>)
      }
      return ir.value
    }
    const runBody = function* (ir: IteratorResult<E1, A>): Generator<CatchEffects<E1, E, E2>, A | B, unknown> {
      while (!ir.done) {
        if (!isEffect(ir.value)) throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        const effect = ir.value
        if (Fail.is(effect) && match(effect.arg as ExtractFail<E1>)) {
          const context = getRuntimeContext(effect)
          const recovery = context === undefined
            ? recover(effect.arg as E, effect as Fail<E>)
            : withActiveRuntimeContext(context, () => recover(effect.arg as E, effect as Fail<E>))
          const recovered = yield* withRuntimeContext(context, recovery) as Fx<E2, B>
          yield* drainClose()
          return recovered
        }
        ir = i.next(yield effect as unknown as CatchEffects<E1, E, E2>)
      }
      return ir.value
    }
    try {
      const value = yield* runBody(i.next())
      completed = true
      return value
    } finally {
      if (!completed) {
        yield* drainClose()
      }
    }
  }
}

type RunCatch<E> =
  E extends Catch<infer _E1, infer _E, infer _E2, infer _A, infer _B> ? never : E

export const runCatch = handle(Catch, effect => {
  const { body, match, recover } = effect.arg
  return ok(new CatchRegion(body, match, recover))
}) as <const E, const A>(fx: Fx<E, A>) => Fx<RunCatch<E>, A>

/**
 * Catch failures matching a type guard and handle them with the provided function.
 * @example
 *   computation.pipe(catchIf(isAuthError, e => recoverFx), runCatch)
 */
export const catchIf = <const E1, const E extends ExtractFail<E1>, const E2, const B>(
  match: (e: ExtractFail<E1>) => e is E,
  handle: (e: E) => Fx<E2, B>
) => <const A>(f: Fx<E1, A>): Fx<Catch<E1, E, E2, A, B> | CatchEffects<E1, E, E2>, A | B> =>
    new Catch(f, match, (e, _failure) => handle(e)).pipe(flatten)

type AnyConstructor = abstract new (...args: any[]) => any

/**
 * Catch failures that are instances of the given constructor and handles them with the provided function.
 * @example
 *   computation.pipe(catchOnly(AuthError, e => recoverFx), runCatch)
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
 *
 * @example
 * ```ts
 * computation.pipe(catchAll(error => recover(error)), runCatch)
 * ```
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
 *   const resultOrError = computation.pipe(returnAll, runCatch)
 */
export const returnAll = <const E, const A>(f: Fx<E, A>) => f.pipe(catchAll(ok))

/**
 * Catch all failures and return them wrapped in a `Fail` instance.
 * @example
 *   const resultOrFail = computation.pipe(returnFail, runCatch)
 */
export const returnFail = <const E, const A>(f: Fx<E, A>) =>
  new Catch(f, (_): _ is ExtractFail<E> => true, (_, failure) => ok(failure))
    .pipe(flatten) as Fx<Catch<E, ExtractFail<E>, never, A, Extract<E, Fail<any>>> | Exclude<E, Fail<any>>, A | Extract<E, Fail<any>>>

/**
 * Assert that an Fx does not fail, throwing the error if it does.
 * @example
 *   const result = trySync(f).pipe(assert) // Crashes if f fails
 */
export const assert = <const E, const A>(f: Fx<E, A>) =>
  new Catch(f, (_): _ is ExtractFail<E> => true, e => { throw e })
    .pipe(flatten) as Fx<Catch<E, ExtractFail<E>, never, A, never> | Exclude<E, Fail<any>>, A>

type UnwrapFail<F> = F extends Fail<infer E> ? E : never
type ExtractFail<F> = UnwrapFail<Extract<F, Fail<any>>>
