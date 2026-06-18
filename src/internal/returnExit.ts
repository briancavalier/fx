import { Abort } from '../Abort.js'
import { Fail } from '../Fail.js'
import { Fx, fx } from '../Fx.js'
import { InterruptFrom } from '../InterruptFrom.js'
import { ReturnFrom } from '../ReturnFrom.js'
import type { AnyControlScope, AnyScope } from '../Scope.js'
import { exitRegion, type ExitRegionWithCleanupExit } from './exitRegion.js'

type ExitEffect =
  | Fail<any>
  | ReturnFrom<AnyControlScope, any>
  | Abort<AnyControlScope>
  | InterruptFrom<AnyScope, any>

export type ResumableExit<A, E extends ExitEffect = ExitEffect> =
  | { readonly type: 'success', readonly value: A }
  | NonSuccessExit<E>
  | WithCleanupExit<E>

export type NonSuccessExit<E extends ExitEffect = ExitEffect> =
  | FailureExit<Extract<E, Fail<any>>>
  | ReturnFromExit<Extract<E, ReturnFrom<AnyControlScope, any>>>
  | AbortExit<Extract<E, Abort<AnyControlScope>>>
  | InterruptedExit<Extract<E, InterruptFrom<AnyScope, any>>>

export type WithCleanupExit<E extends ExitEffect = ExitEffect> =
  ExitRegionWithCleanupExit<NonSuccessExit<E>>

export type FailureExit<E extends Fail<any>> =
  E extends never ? never : { readonly type: 'failure', readonly effect: E }

export type ReturnFromExit<E extends ReturnFrom<AnyControlScope, any>> =
  E extends never ? never : { readonly type: 'returnFrom', readonly effect: E }

export type AbortExit<E extends Abort<AnyControlScope>> =
  E extends never ? never : { readonly type: 'abort', readonly effect: E }

export type InterruptedExit<E extends InterruptFrom<AnyScope, any>> =
  E extends never ? never : { readonly type: 'interrupted', readonly effect: E }

type ResumableExitEffect<Exit> =
  Exit extends {
    readonly type: 'withCleanupExit',
    readonly primary: infer Primary,
    readonly cleanup: infer Cleanup
  } ? ResumableExitEffect<Primary> | ResumableExitEffect<Cleanup>
  : Exit extends { readonly type: 'success' } ? never
  : Exit extends { readonly effect: infer E extends ExitEffect } ? E
  : never

type EffectiveExit<Exit> =
  Exit extends {
    readonly type: 'withCleanupExit',
    readonly primary: infer Primary extends NonSuccessExit<any>,
    readonly cleanup: infer Cleanup extends NonSuccessExit<any>
  } ? Primary extends { readonly type: 'failure' } ? Primary : EffectiveExit<Cleanup>
  : Exit

type ExitOf<E, A> = ResumableExit<A, Extract<E, ExitEffect>>
type NonSuccessExitOf<E> = NonSuccessExit<Extract<E, ExitEffect>>
type ReturnExitEffects<E> = Exclude<E, ExitEffect>

export const returnExit = <const E, const A>(
  f: Fx<E, A>
): Fx<ReturnExitEffects<E>, ExitOf<E, A>> =>
  exitRegion(f, {
    classify: toExit<E>,
    step: function* (effect) {
      return { type: 'continue', value: yield effect }
    },
    resume: exit => resumeExit(exit) as Fx<E, never>
  }) as Fx<ReturnExitEffects<E>, ExitOf<E, A>>

export const effectiveExit = <const Exit extends ResumableExit<any, any>>(
  exit: Exit
): EffectiveExit<Exit> => {
  let current: ResumableExit<any, any> = exit
  while (current.type === 'withCleanupExit') {
    current = current.primary.type === 'failure' ? current.primary : current.cleanup
  }
  return current as EffectiveExit<Exit>
}

export const resumeExit = <const Exit extends ResumableExit<any, any>>(
  exit: Exit
): Fx<ResumableExitEffect<Exit>, Exit extends { readonly type: 'success', readonly value: infer A } ? A : never> =>
  fx(function* () {
    const effective = effectiveExit(exit)
    if (effective.type === 'success') return effective.value
    return (yield effective.effect) as never
  }) as Fx<ResumableExitEffect<Exit>, Exit extends { readonly type: 'success', readonly value: infer A } ? A : never>

const toExit = <E>(effect: E): NonSuccessExitOf<E> | undefined => {
  if (Fail.is(effect)) return { type: 'failure', effect } as NonSuccessExitOf<E>
  if (ReturnFrom.is(effect)) return { type: 'returnFrom', effect } as NonSuccessExitOf<E>
  if (Abort.is(effect)) return { type: 'abort', effect } as NonSuccessExitOf<E>
  if (InterruptFrom.is(effect)) return { type: 'interrupted', effect } as NonSuccessExitOf<E>
  return undefined
}
