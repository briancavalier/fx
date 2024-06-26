import { Async } from './Async'
import { EffectType } from './Effect'
import { provideAll } from './Env'
import { Fail, fail } from './Fail'
import { Task } from './Task'
import { Answer, Arg, Handler, empty } from './internal/Handler'
import { GetHandlerContext } from './internal/HandlerContext'
import * as generator from './internal/generator'
import { Pipeable } from './internal/pipe'
import { runFork } from './internal/runFork'

/**
 * A computation that produces a value of type `A`, and may produce effects of
 * type `E`.
 */
export interface Fx<E, A> extends Pipeable {
  [Symbol.iterator](): Iterator<E, A, unknown>
}

/**
 * Construct an Fx from a generator that uses `yield*` to produce effects.
 */
export const fx: {
  <const E, const A>(f: () => Generator<E, A>): Fx<E, A>
  <const T, const E, const A>(self: T, f: (this: T) => Generator<E, A>): Fx<E, A>
} = function () {
  return arguments.length === 1
    ? new generator.Gen(undefined, arguments[0])
    : new generator.Gen(arguments[0], arguments[1])
}

/**
 * Construct an Fx from a pure value. The returned Fx will produce no effects.
 */
export const ok = <const A>(a: A): Fx<never, A> => new generator.Ok(a)

export const unit = ok(undefined)

/**
 * Convert an synchronous side-effect function into an Fx. If the function throws,
 * the error will be propagated as a {@link Fail} effect.
 */
export const trySync = <const A>(f: () => A): Fx<Fail<unknown>, A> => fx(function* () {
  try {
    return f()
  } catch (e) {
    return yield* fail(e)
  }
})

export const map = <const A, const B>(f: (a: A) => B) =>
  <const E>(x: Fx<E, A>): Fx<E, B> => new generator.Map<E, A, B>(f, x as any) as Fx<E, B>

export const flatMap = <const A, const E2, const B>(f: (a: A) => Fx<E2, B>) =>
  <const E1>(x: Fx<E1, A>): Fx<E1 | E2, B> => new generator.FlatMap(f, x as any) as Fx<E1 | E2, B>

export const flatten = <const E1, const E2, const A>(x: Fx<E1, Fx<E2, A>>): Fx<E1 | E2, A> =>
  x.pipe(flatMap(x => x))

/**
 * Execute all the effects of the provided Fx, and return a {@link Task} for its result.
 */
export const runTask = <const R>(f: Fx<Async | GetHandlerContext, R>): Task<R, never> =>
  runFork(f.pipe(provideAll({})), { name: 'Fx:toTask' })

/**
 * Execute all the effects of the provided Fx, and return a Promise for its result,
 * discarding the ability to cancel the computation.
 */
export const runPromise = <const R>(f: Fx<Async | GetHandlerContext, R>): Promise<R> =>
  runTask(f).promise

/**
 * Execute all the effects of the provided Fx, and return its result.
 */
export const run = <const R>(f: Fx<never, R>): R =>
  f.pipe(provideAll({}), getResult)

const getResult = <const R>(f: Fx<never, R>): R => f[Symbol.iterator]().next().value

export const bracket = <const IE, const FE, const E, const R, const A>(init: Fx<IE, R>, fin: (a: R) => Fx<FE, void>, f: (a: R) => Fx<E, A>) => fx(function* () {
  const r = yield* init
  try {
    return yield* f(r)
  } finally {
    yield* fin(r)
  }
})

export type Handle<E, A, B = never> = E extends A ? B : E

export type HandleReturn<E, A, R> = E extends A ? R : never

export const handle = <T extends EffectType, HandlerEffects>(e: T, f: (e: Arg<T>) => Fx<HandlerEffects, Answer<T>>) =>
  <const E, const A>(fx: Fx<E, A>): Fx<Handle<E, InstanceType<T>, HandlerEffects>, A> =>
    new Handler(fx, new Map().set(e._fxEffectId, f), empty) as Fx<Handle<E, InstanceType<T>, HandlerEffects>, A>

export const control = <T extends EffectType, HandlerEffects = never, R = never>(e: T, f: <A>(resume: (a: Answer<T>) => A, e: Arg<T>) => Fx<HandlerEffects, R>) =>
  <const E, const A>(fx: Fx<E, A>): Fx<Handle<E, InstanceType<T>, HandlerEffects>, HandleReturn<E, InstanceType<T>, R> | A> =>
    new Handler(fx, empty, new Map().set(e._fxEffectId, f)) as Fx<Handle<E, InstanceType<T>, HandlerEffects>, HandleReturn<E, InstanceType<T>, R> | A>
