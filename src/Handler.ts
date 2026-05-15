import { EffectType } from './Effect.js'
import { Fx } from './Fx.js'
import { Answer, Arg, Control, Handler } from './internal/Handler.js'
export type { Arg }

export type Handle<E, A, B = never> = E extends A ? B : E

export type HandleReturn<E, A, R> = E extends A ? R : never

export type HandleScoped<E, A, Scope extends string, B = never> =
  E extends A
  ? E extends { readonly scope: Scope } ? B : E
  : E

export type ScopedEffectType =
  EffectType & { new(...args: readonly any[]): { readonly scope: string } }

export type EffectScope<T extends ScopedEffectType> =
  InstanceType<T>['scope']

export const handle = <T extends EffectType, HandlerEffects>(
  e: T,
  f: (effect: InstanceType<T>) => Fx<HandlerEffects, Answer<T>>
) => <const E, const A>(
  fx: Fx<E, A>
): Fx<Handle<E, InstanceType<T>, HandlerEffects>, A> =>
    new Handler(fx, e._fxEffectId, f) as Fx<Handle<E, InstanceType<T>, HandlerEffects>, A>

export const handleScoped = <T extends ScopedEffectType, const Scope extends EffectScope<T>, HandlerEffects>(
  e: T,
  scope: Scope,
  f: (effect: InstanceType<T>) => Fx<HandlerEffects, Answer<T>>
) => <const E, const A>(
  fx: Fx<E, A>
): Fx<HandleScoped<E, InstanceType<T>, Scope, HandlerEffects>, A> =>
    new Handler(fx, e._fxEffectId, effect => {
      if (effect.scope === scope) {
        return f(effect as InstanceType<T>)
      }

      return effect as Fx<InstanceType<T>, Answer<T>>
    }) as Fx<HandleScoped<E, InstanceType<T>, Scope, HandlerEffects>, A>

export const control = <T extends EffectType, HandlerEffects = never, R = never>(
  e: T,
  f: <A>(resume: (a: Answer<T>) => A, effect: InstanceType<T>) => Fx<HandlerEffects, R>
) => <const E, const A>(
  fx: Fx<E, A>
): Fx<Handle<E, InstanceType<T>, HandlerEffects>, HandleReturn<E, InstanceType<T>, R> | A> =>
    new Control(fx, e._fxEffectId, f) as Fx<Handle<E, InstanceType<T>, HandlerEffects>, HandleReturn<E, InstanceType<T>, R> | A>
