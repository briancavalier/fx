import { Async } from "./Async"
import { EffectType } from './Effect'
import { provideAll } from "./Env"
import { Fork } from "./Fork"
import { Task } from './Task'
import { Arg, Handler, Return, empty, isHandler } from './internal/Handler'
import { Semaphore } from "./internal/Semaphore"
import * as generator from './internal/generator'
import { Pipeable } from './internal/pipe'
import { runFork } from './internal/runFork'

export interface Fx<E, A> extends Pipeable {
  [Symbol.iterator](): Iterator<E, A, unknown>
}

export const fx = <const E, const A>(f: () => Generator<E, A>): Fx<E, A> => new generator.Gen(f)

export const ok = <const A>(a: A): Fx<never, A> => new generator.Ok(a)

export const sync = <const A>(f: () => A): Fx<never, A> => new generator.Sync(f)

export const unit = ok(undefined)

export const map = <const A, const B>(f: (a: A) => B) =>
  <const E>(x: Fx<E, A>): Fx<E, B> => new generator.Map<E, A, B>(f, x as any) as Fx<E, B>

export const run = <const R>(f: Fx<Fork | Async, R>): Task<R, never> =>
  runFork(f.pipe(provideAll({})), new Semaphore(Infinity), 'Fx:run')

export const runSync = <const R>(f: Fx<never, R>): R =>
  getResult(f.pipe(provideAll({})))

const getResult = <const R>(f: Fx<never, R>): R => f[Symbol.iterator]().next().value

export const bracket = <const IE, const FE, const E, const R, const A>(init: Fx<IE, R>, fin: (a: R) => Fx<FE, void>, f: (a: R) => Fx<E, A>) => fx(function* () {
  const r = yield* init
  try {
    return yield* f(r)
  } finally {
    yield* fin(r)
  }
})

export const handle = <T extends EffectType, OnEffects>(e: T, f: (e: Arg<T>) => Fx<OnEffects, Return<T>>) => <const E, const A>(fx: Fx<E, A>): Handler<Exclude<E, InstanceType<T>> | OnEffects, A> => (isHandler(fx)
  ? new Handler(fx, new Map(fx.handlers).set(e._fxEffectId, f), fx.controls)
  : new Handler(fx, new Map().set(e._fxEffectId, f), empty)) as Handler<Exclude<E, InstanceType<T>> | OnEffects, A>

export const control = <T extends EffectType, OnEffects, R = never>(e: T, f: <A>(resume: (a: Return<T>) => A, e: Arg<T>) => Fx<OnEffects, R>) => <const E, const A>(fx: Fx<E, A>): Handler<Exclude<E, InstanceType<T>> | OnEffects, A | R> => (isHandler(fx)
  ? new Handler(fx, fx.handlers, new Map(fx.controls).set(e._fxEffectId, f as any))
  : new Handler(fx, empty, new Map().set(e._fxEffectId, f))) as Handler<Exclude<E, InstanceType<T>> | OnEffects, A | R>
