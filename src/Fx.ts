import { Async } from './Async'
import { EffectType } from './Effect'
import { provideAll } from './Env'
import { Task } from './Task'
import { Answer, Arg, Handler, empty, isHandler } from './internal/Handler'
import * as generator from './internal/generator'
import { Pipeable } from './internal/pipe'
import { runFork } from './internal/runFork'

export interface Fx<E, A> extends Pipeable {
  [Symbol.iterator](): Iterator<E, A, unknown>
}

export const fx: {
  <const E, const A>(f: () => Generator<E, A>): Fx<E, A>
  <const T, const E, const A>(self: T, f: (this: T) => Generator<E, A>): Fx<E, A>
} = function (...args: any[]) {
  return arguments.length === 1
    ? new generator.Gen(arguments[0])
    : new generator.Gen(arguments[1].bind(arguments[0]))
}

export const ok = <const A>(a: A): Fx<never, A> => new generator.Ok(a)

export const sync = <const A>(f: () => A): Fx<never, A> => new generator.Sync(f)

export const unit = ok(undefined)

export const map = <const A, const B>(f: (a: A) => B) =>
  <const E>(x: Fx<E, A>): Fx<E, B> => new generator.Map<E, A, B>(f, x as any) as Fx<E, B>

export const flatMap = <const A, const E2, const B>(f: (a: A) => Fx<E2, B>) =>
  <const E1>(x: Fx<E1, A>): Fx<E1 | E2, B> => fx(function* () {
    return yield* f(yield* x)
  })

export const runAsync = <const R>(f: Fx<Async, R>): Task<R, never> =>
  runFork(f.pipe(provideAll({})), { name: 'Fx:runAsync' })

export const runSync = <const R>(f: Fx<never, R>): R =>
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

export const handle = <T extends EffectType, HandlerEffects>(e: T, f: (e: Arg<T>) => Fx<HandlerEffects, Answer<T>>) =>
  <const E, const A>(fx: Fx<E, A>): Handler<Handle<E, InstanceType<T>, HandlerEffects>, A> =>
    (isHandler(fx)
      ? new Handler(fx, new Map(fx.handlers).set(e._fxEffectId, f), fx.controls)
      : new Handler(fx, new Map().set(e._fxEffectId, f), empty)) as Handler<Handle<E, InstanceType<T>, HandlerEffects>, A>

export const control = <T extends EffectType, HandlerEffects, R = never>(e: T, f: <A>(resume: (a: Answer<T>) => A, e: Arg<T>) => Fx<HandlerEffects, R>) =>
  <const E, const A>(fx: Fx<E, A>): Handler<Exclude<E, InstanceType<T>> | HandlerEffects, A> =>
    (isHandler(fx)
      ? new Handler(fx, fx.handlers, new Map(fx.controls).set(e._fxEffectId, f as any))
      : new Handler(fx, empty, new Map().set(e._fxEffectId, f))) as Handler<Exclude<E, InstanceType<T>> | HandlerEffects, A>
