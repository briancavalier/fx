import { EffectType } from './Effect'
import { Fx } from './Fx'
import { Answer, Arg, Handler, empty } from './internal/Handler'

export type Handle<E, A, B = never> = E extends A ? B : E

export type HandleReturn<E, A, R> = E extends A ? R : never

export const handle = <T extends EffectType, HandlerEffects>(e: T, f: (e: Arg<T>) => Fx<HandlerEffects, Answer<T>>) => <const E, const A>(fx: Fx<E, A>): Fx<Handle<E, InstanceType<T>, HandlerEffects>, A> => new Handler(fx, new Map().set(e._fxEffectId, f), empty) as Fx<Handle<E, InstanceType<T>, HandlerEffects>, A>

export const control = <T extends EffectType, HandlerEffects = never, R = never>(e: T, f: <A>(resume: (a: Answer<T>) => A, e: Arg<T>) => Fx<HandlerEffects, R>) => <const E, const A>(fx: Fx<E, A>): Fx<Handle<E, InstanceType<T>, HandlerEffects>, HandleReturn<E, InstanceType<T>, R> | A> => new Handler(fx, empty, new Map().set(e._fxEffectId, f)) as Fx<Handle<E, InstanceType<T>, HandlerEffects>, HandleReturn<E, InstanceType<T>, R> | A>
