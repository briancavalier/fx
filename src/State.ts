import { ScopedEffect } from './Effect.js'
import { Fx, fx, ok } from './Fx.js'
import { handleScoped, type HandleScoped } from './Handler.js'
import { scope as scoped, type ReturnValue, type ScopeEffects } from './Scope.js'

declare const StatefulTypeId: unique symbol

export type Stateful<A> = {
  readonly [StatefulTypeId]: A
}

export type StateOf<Scope> =
  Scope extends Stateful<infer A> ? A : never

/**
 * Read the current state from the named scope.
 */
export class GetState<const Scope extends string & Stateful<unknown>>
  extends ScopedEffect('fx/State/Get')<Scope, void, StateOf<Scope>> { }

/**
 * Replace the current state and return a computed result.
 */
export class ModifyState<const Scope extends string & Stateful<unknown>, const B = unknown>
  extends ScopedEffect('fx/State/Modify')<Scope, (state: StateOf<Scope>) => readonly [StateOf<Scope>, B], B> { }

export type StateEffects<Scope extends string & Stateful<unknown>> =
  | GetState<Scope>
  | ModifyState<Scope>

export type ExcludeState<E, Scope extends string & Stateful<unknown>> =
  HandleScoped<HandleScoped<E, GetState<Scope>, Scope>, ModifyState<Scope>, Scope>

export const getState = <const Scope extends string & Stateful<unknown>>(scope: Scope): Fx<GetState<Scope>, StateOf<Scope>> =>
  new GetState(scope, undefined)

export const modifyState = <const Scope extends string & Stateful<unknown>, const B>(
  scope: Scope,
  f: (state: StateOf<Scope>) => readonly [StateOf<Scope>, B]
): Fx<ModifyState<Scope, B>, B> =>
  new ModifyState(scope, f)

/**
 * Handle state operations for the named scope with state local to one execution.
 */
export const withState = <const Scope extends string & Stateful<unknown>>(
  scope: Scope,
  initial: StateOf<Scope>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ScopeEffects<ExcludeState<E, Scope>, Scope>, A | ReturnValue<ExcludeState<E, Scope>, Scope>> =>
    fx(function* () {
      let state = initial

      return yield* f.pipe(
        handleScoped(GetState<Scope>, scope, () => ok(state)),
        handleScoped(ModifyState<Scope>, scope, effect => {
          const [next, result] = effect.arg(state)
          state = next
          return ok(result)
        }),
        scoped(scope)
      )
    }) as Fx<ScopeEffects<ExcludeState<E, Scope>, Scope>, A | ReturnValue<ExcludeState<E, Scope>, Scope>>
