import { KeyedEffect } from './Effect.js'
import { Fx, flatMap, fx, ok } from './Fx.js'
import { handleKeyed, type HandleKeyed } from './Handler.js'
import { AnyKey } from './Key.js'
import { effectiveExit, returnExit, resumeExit } from './internal/returnExit.js'

declare const StatefulTypeId: unique symbol

export type Stateful<A> = {
  readonly [StatefulTypeId]: A
}

export type StateOf<Scope> =
  Scope extends Stateful<infer A> ? A : never

/**
 * Read the current state from the named scope.
 */
export class GetState<const Key extends AnyKey & Stateful<unknown>>
  extends KeyedEffect('fx/State/Get')<Key, void, StateOf<Key>> { }

/**
 * Replace the current state and return a computed result.
 */
export class ModifyState<const Key extends AnyKey & Stateful<unknown>, const B = unknown>
  extends KeyedEffect('fx/State/Modify')<Key, (state: StateOf<Key>) => readonly [StateOf<Key>, B], B> { }

export type StateEffects<Key extends AnyKey & Stateful<unknown>> =
  | GetState<Key>
  | ModifyState<Key>

export type ExcludeState<E, Key extends AnyKey & Stateful<unknown>> =
  HandleKeyed<HandleKeyed<E, GetState<Key>, Key>, ModifyState<Key>, Key>

export const getState = <const Key extends AnyKey & Stateful<unknown>>(key: Key): Fx<GetState<Key>, StateOf<Key>> =>
  new GetState(key, undefined)

export const modifyState = <const Key extends AnyKey & Stateful<unknown>, const B>(
  key: Key,
  f: (state: StateOf<Key>) => readonly [StateOf<Key>, B]
): Fx<ModifyState<Key, B>, B> =>
  new ModifyState(key, f)

/**
 * Handle state operations for the named scope with state local to one execution.
 */
export const withState = <const Key extends AnyKey & Stateful<unknown>>(
  key: Key,
  initial: StateOf<Key>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ExcludeState<E, Key>, A> =>
    fx(function* () {
      let state = initial

      return yield* f.pipe(
        handleKeyed(GetState<Key>, key, () => ok(state)),
        handleKeyed(ModifyState<Key>, key, effect => {
          const [next, result] = effect.arg(state)
          state = next
          return ok(result)
        })
      )
    }) as Fx<ExcludeState<E, Key>, A>

/**
 * Handle state operations for the named scope, obtaining the initial state by
 * running an Fx once per execution.
 */
export const withStateInit = <const Key extends AnyKey & Stateful<unknown>, const IE>(
  key: Key,
  initially: Fx<IE, StateOf<Key>>
) => <const E, const A>(
  f: Fx<E, A>
) =>
    initially.pipe(flatMap(s => f.pipe(withState(key, s))))

/**
 * Run matching state operations transactionally for the named scope.
 *
 * The current durable state is copied before the protected region runs.
 * Matching state operations update the local copy, and the transaction commits
 * it back to the durable state only if the region succeeds or returns from a
 * control scope.
 */
export const transactionalState = <const Key extends AnyKey & Stateful<unknown>>(
  key: Key
) => <const E, const A>(
  body: Fx<E, A>
): Fx<ExcludeState<E, Key> | StateEffects<Key>, A> =>
    fx(function* () {
      let state = yield* getState(key)
      let dirty = false

      const exit = yield* body.pipe(
        returnExit,
        handleKeyed(GetState<Key>, key, () => ok(state)),
        handleKeyed(ModifyState<Key, unknown>, key, effect => {
          const [next, result] = effect.arg(state)
          state = next
          dirty = true
          return ok(result)
        })
      )

      const effective = effectiveExit(exit)
      if (dirty && (effective.type === 'success' || effective.type === 'returnFrom')) {
        yield* modifyState(key, () => [state, undefined])
      }

      return yield* resumeExit(exit)
    }) as Fx<ExcludeState<E, Key> | StateEffects<Key>, A>
