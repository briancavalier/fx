import { ScopedEffect } from './Effect.js'
import { andFinally } from './Finalization.js'
import { Fx, flatMap, fx, ok, unit } from './Fx.js'
import { handleScoped, type HandleScoped } from './Handler.js'
import { AnyScope, scope as createScope, withScope } from './Scope.js'

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

export const getState = <const Scope extends AnyScope & Stateful<unknown>>(scope: Scope): Fx<GetState<Scope>, StateOf<Scope>> =>
  new GetState(scope, undefined)

export const modifyState = <const Scope extends AnyScope & Stateful<unknown>, const B>(
  scope: Scope,
  f: (state: StateOf<Scope>) => readonly [StateOf<Scope>, B]
): Fx<ModifyState<Scope, B>, B> =>
  new ModifyState(scope, f)

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
) =>
    initially.pipe(flatMap(s => f.pipe(withState(scope, s))))

/**
 * Run matching state operations transactionally for the named scope.
 *
 * The current durable state is copied into a private scope before the protected
 * region runs. Matching state operations update the local copy, and the private
 * scope commits it back to the durable state only if the region succeeds.
 */
export const transactionalState = <const Scope extends AnyScope & Stateful<unknown>>(
  scope: Scope
) => <const E, const A>(
  body: Fx<E, A>
): Fx<ExcludeState<E, Scope> | StateEffects<Scope>, A> =>
    // The private scope only owns this transaction's commit finalizer.
    // Its scope effects cannot escape, but TypeScript cannot reduce that
    // through the generic body effect union.
    fx(function* () {
      let state = yield* getState(scope)
      let dirty = false

      yield* andFinally(exit =>
        dirty && (exit.type === 'success' || exit.type === 'returnFrom')
          ? modifyState(scope, () => [state, undefined])
          : unit)

      return yield* body.pipe(
        handleScoped(GetState<Scope>, scope, () => ok(state)),
        handleScoped(ModifyState<Scope, unknown>, scope, effect => {
          const [next, result] = effect.arg(state)
          state = next
          dirty = true
          return ok(result)
        })
      )
    }).pipe(withScope(createScope(Symbol('fx/State/transaction')))) as Fx<ExcludeState<E, Scope> | StateEffects<Scope>, A>
