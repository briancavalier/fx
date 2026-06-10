import { ScopedEffect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, fx, ok } from './Fx.js'
import { control, handleScoped, type HandleScoped } from './Handler.js'
import type { AnyScope } from './Scope.js'

declare const StatefulTypeId: unique symbol

export type Stateful<A> = {
  readonly [StatefulTypeId]: A
}

export type StateOf<Scope> =
  Scope extends Stateful<infer A> ? A : never

/**
 * Read the current state from the named scope.
 */
export class GetState<const Scope extends AnyScope & Stateful<unknown>>
  extends ScopedEffect('fx/State/Get')<Scope, void, StateOf<Scope>> { }

/**
 * Replace the current state and return a computed result.
 */
export class ModifyState<const Scope extends AnyScope & Stateful<unknown>, const B = unknown>
  extends ScopedEffect('fx/State/Modify')<Scope, (state: StateOf<Scope>) => readonly [StateOf<Scope>, B], B> { }

export type StateEffects<Scope extends AnyScope & Stateful<unknown>> =
  | GetState<Scope>
  | ModifyState<Scope>

export type ExcludeState<E, Scope extends AnyScope & Stateful<unknown>> =
  HandleScoped<HandleScoped<E, GetState<Scope>, Scope>, ModifyState<Scope>, Scope>

export type ExcludeCheckpointedState<E, Scope extends AnyScope & Stateful<unknown>> =
  HandleScoped<ExcludeState<E, Scope>, CheckpointState<Scope, any, any>, Scope>

export const getState = <const Scope extends AnyScope & Stateful<unknown>>(scope: Scope): Fx<GetState<Scope>, StateOf<Scope>> =>
  new GetState(scope, undefined)

export const modifyState = <const Scope extends AnyScope & Stateful<unknown>, const B>(
  scope: Scope,
  f: (state: StateOf<Scope>) => readonly [StateOf<Scope>, B]
): Fx<ModifyState<Scope, B>, B> =>
  new ModifyState(scope, f)

export class CheckpointState<const Scope extends AnyScope & Stateful<unknown>, const E, const A>
  extends ScopedEffect('fx/State/Checkpoint')<Scope, Fx<E, A>, Fx<E, A>> { }

export const checkpointState = <const Scope extends AnyScope & Stateful<unknown>, const E, const A>(
  scope: Scope,
  body: Fx<E, A>
): Fx<CheckpointState<Scope, E, A>, Fx<E, A>> =>
  new CheckpointState(scope, body)

/**
 * Handle state operations for the named scope with state local to one execution.
 */
export const withState = <const Scope extends AnyScope & Stateful<unknown>>(
  scope: Scope,
  initial: StateOf<Scope>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ExcludeState<E, Scope>, A> =>
    fx(function* () {
      let state = initial

      return yield* f.pipe(
        handleScoped(GetState<Scope>, scope, () => ok(state)),
        handleScoped(ModifyState<Scope>, scope, effect => {
          const [next, result] = effect.arg(state)
          state = next
          return ok(result)
        })
      )
    }) as Fx<ExcludeState<E, Scope>, A>

/**
 * Handle state operations for the named scope, obtaining the initial state by
 * running an Fx once per execution.
 */
export const withStateInit = <const Scope extends AnyScope & Stateful<unknown>, const IE>(
  scope: Scope,
  initially: Fx<IE, StateOf<Scope>>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<IE | ExcludeState<E, Scope>, A> =>
    fx(function* () {
      const initial = yield* initially
      return yield* f.pipe(withState(scope, initial))
    }) as Fx<IE | ExcludeState<E, Scope>, A>

/**
 * Handle state operations for the named scope, checkpointing state when a
 * scoped catch interpreter asks to protect a recovery region.
 */
export const withCheckpointedState = <const Scope extends AnyScope & Stateful<unknown>>(
  scope: Scope,
  initial: StateOf<Scope>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ExcludeCheckpointedState<E, Scope>, A> =>
    fx(function* () {
      let state = initial

      return yield* f.pipe(
        handleScoped(GetState<Scope>, scope, () => ok(state)),
        handleScoped(ModifyState<Scope>, scope, effect => {
          const [next, result] = effect.arg(state)
          state = next
          return ok(result)
        }),
        handleScoped(CheckpointState<Scope, any, any>, scope, effect => {
          const saved = state

          return ok(effect.arg.pipe(
            control(Fail, (_, failure) => {
              state = saved
              return failure
            })
          ) as typeof effect.arg)
        })
      )
    }) as Fx<ExcludeCheckpointedState<E, Scope>, A>

/**
 * Handle checkpointed state operations for the named scope, obtaining the
 * initial state by running an Fx once per execution.
 */
export const withCheckpointedStateInit = <const Scope extends AnyScope & Stateful<unknown>, const IE>(
  scope: Scope,
  initially: Fx<IE, StateOf<Scope>>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<IE | ExcludeCheckpointedState<E, Scope>, A> =>
    fx(function* () {
      const initial = yield* initially
      return yield* f.pipe(withCheckpointedState(scope, initial))
    }) as Fx<IE | ExcludeCheckpointedState<E, Scope>, A>
