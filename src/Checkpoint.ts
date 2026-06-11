import { ScopedEffect } from './Effect.js'
import { flatten, type Fx } from './Fx.js'
import type { AnyScope } from './Scope.js'

/**
 * Request that an interpreter run a computation with checkpoint semantics for a
 * named scope.
 */
export class Checkpoint<const Scope extends AnyScope, const E, const A>
  extends ScopedEffect('fx/Checkpoint')<Scope, Fx<E, A>, Fx<E, A>> { }

/**
 * Wrap a computation in a checkpoint boundary for the named scope.
 */
export const checkpoint = <const Scope extends AnyScope>(scope: Scope) =>
  <const E, const A>(body: Fx<E, A>): Fx<Checkpoint<Scope, E, A> | E, A> =>
    new Checkpoint(scope, body).pipe(flatten)
