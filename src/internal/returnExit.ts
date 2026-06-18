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

type ExitOf<E, A> = ResumableExit<A, Extract<E, ExitEffect>>
type NonSuccessExitOf<E> = NonSuccessExit<Extract<E, ExitEffect>>
type ReturnExitEffects<E> = Exclude<E, ExitEffect>

export const returnExit = <const E, const A>(
  f: Fx<E, A>
): Fx<ReturnExitEffects<E>, ExitOf<E, A>> =>
  exitRegion(f, {
    classify: toExit<E>,
    resume: exit => resumeExit(exit) as Fx<E, never>,
    unavailableExitMessage: 'Exit unavailable after closing interrupted region'
  }) as Fx<ReturnExitEffects<E>, ExitOf<E, A>>

export const resumeExit = <const Exit extends ResumableExit<any, any>>(
  exit: Exit
): Fx<ResumableExitEffect<Exit>, Exit extends { readonly type: 'success', readonly value: infer A } ? A : never> =>
  fx(function* () {
    if (exit.type === 'success') return exit.value
    if (exit.type === 'withCleanupExit') {
      return yield* resumeExit(exit.primary.type === 'failure' ? exit.primary : exit.cleanup)
    }
    return (yield exit.effect) as never
  }) as Fx<ResumableExitEffect<Exit>, Exit extends { readonly type: 'success', readonly value: infer A } ? A : never>

const toExit = <E>(effect: E): NonSuccessExitOf<E> | undefined => {
  if (Fail.is(effect)) return { type: 'failure', effect } as NonSuccessExitOf<E>
  if (ReturnFrom.is(effect)) return { type: 'returnFrom', effect } as NonSuccessExitOf<E>
  if (Abort.is(effect)) return { type: 'abort', effect } as NonSuccessExitOf<E>
  if (InterruptFrom.is(effect)) return { type: 'interrupted', effect } as NonSuccessExitOf<E>
  return undefined
}
