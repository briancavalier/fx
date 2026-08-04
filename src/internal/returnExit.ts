import { Abort } from '../Abort.js'
import { Fail } from '../Fail.js'
import { Fx, fx } from '../Fx.js'
import { InterruptFrom } from '../InterruptFrom.js'
import { ReturnFrom } from '../ReturnFrom.js'
import type { AnyControlScope, AnyScope } from '../Scope.js'
import { exitRegion, type CapturedCleanupExit } from './exitRegion.js'

export type ExitEffect =
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
  CapturedCleanupExit<NonSuccessExit<E>>

export type FailureExit<E extends Fail<any>> =
  E extends never ? never : { readonly type: 'failure', readonly effect: E }

export type ReturnFromExit<E extends ReturnFrom<AnyControlScope, any>> =
  E extends never ? never : { readonly type: 'returnFrom', readonly effect: E }

export type AbortExit<E extends Abort<AnyControlScope>> =
  E extends never ? never : { readonly type: 'abort', readonly effect: E }

export type InterruptedExit<E extends InterruptFrom<AnyScope, any>> =
  E extends never ? never : { readonly type: 'interrupted', readonly effect: E }

type ExitOf<E, A> = ResumableExit<A, Extract<E, ExitEffect>>
type NonSuccessExitOf<E> = NonSuccessExit<Extract<E, ExitEffect>>
type ReturnExitEffects<E> = Exclude<E, ExitEffect>
type EffectiveExit<A, E extends ExitEffect> =
  | { readonly type: 'success', readonly value: A }
  | NonSuccessExit<E>

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

export const effectiveExit = <const A, const E extends ExitEffect>(
  exit: ResumableExit<A, E>
): EffectiveExit<A, E> => {
  let current: ResumableExit<A, E> = exit
  while (current.type === 'withCleanupExit') {
    current = current.primary.type === 'failure' ? current.primary : current.cleanup
  }
  return current as EffectiveExit<A, E>
}

export const withCleanupExit = <const A, const E extends ExitEffect, const CE extends ExitEffect>(
  primary: ResumableExit<A, E>,
  cleanup: ResumableExit<void, CE>
): ResumableExit<A, E | CE> => {
  if (cleanup.type === 'success') return primary
  if (primary.type === 'success') return cleanup
  return mergeCleanupExit(primary, cleanup)
}

const mergeCleanupExit = <const E extends ExitEffect, const CE extends ExitEffect>(
  primary: NonSuccessExit<E> | WithCleanupExit<E>,
  cleanup: NonSuccessExit<CE> | WithCleanupExit<CE>
): WithCleanupExit<E | CE> =>
  primary.type === 'withCleanupExit'
    ? {
        type: 'withCleanupExit',
        primary: primary.primary,
        cleanup: mergeCleanupExit(primary.cleanup, cleanup)
      } as WithCleanupExit<E | CE>
    : {
        type: 'withCleanupExit',
        primary,
        cleanup
      } as WithCleanupExit<E | CE>

export function resumeExit<const A>(
  exit: { readonly type: 'success', readonly value: A }
): Fx<never, A>
export function resumeExit<const E extends ExitEffect>(
  exit: NonSuccessExit<E> | WithCleanupExit<E>
): Fx<E, never>
export function resumeExit<const A, const E extends ExitEffect>(
  exit: ResumableExit<A, E>
): Fx<E, A>
export function resumeExit(
  exit: ResumableExit<any, ExitEffect>
): Fx<ExitEffect, any> {
  return fx(function* () {
    const effective = effectiveExit(exit)
    if (effective.type === 'success') return effective.value
    return yield effective.effect
  })
}

const toExit = <E>(effect: E): NonSuccessExitOf<E> | undefined => {
  if (Fail.is(effect)) return { type: 'failure', effect } as NonSuccessExitOf<E>
  if (ReturnFrom.is(effect)) return { type: 'returnFrom', effect } as NonSuccessExitOf<E>
  if (Abort.is(effect)) return { type: 'abort', effect } as NonSuccessExitOf<E>
  if (InterruptFrom.is(effect)) return { type: 'interrupted', effect } as NonSuccessExitOf<E>
  return undefined
}
