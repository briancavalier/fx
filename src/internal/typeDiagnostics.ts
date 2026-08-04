import type { IfAny } from './type.js'

type UnhandledEffects<E, RuntimeEffects> = Exclude<E, RuntimeEffects>

type EffectIdOf<E> = E extends { readonly _fxEffectId: infer Id extends string } ? Id : 'unknown effect'

type UnhandledEffectsError<Effects> = {
  readonly [K in `Unhandled effect ${EffectIdOf<Effects>}. Add a handler for it.`]: Effects
}

export type RunBoundary<E, RuntimeEffects> =
  [IfAny<E, never>] extends [never]
    ? unknown
    : [UnhandledEffects<E, RuntimeEffects>] extends [never]
      ? unknown
      : UnhandledEffectsError<UnhandledEffects<E, RuntimeEffects>>
