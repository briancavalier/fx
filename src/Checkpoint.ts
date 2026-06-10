import { ScopedEffect } from './Effect.js'
import type { Fx } from './Fx.js'
import type { AnyScope } from './Scope.js'

/**
 * Request that an interpreter run a computation with checkpoint semantics for
 * the named scope.
 */
export class Checkpoint<const Scope extends AnyScope, const E, const A>
  extends ScopedEffect('fx/Checkpoint')<Scope, Fx<E, A>, Fx<E, A>> { }

export const checkpoint = <const Scope extends AnyScope, const E, const A>(
  scope: Scope,
  body: Fx<E, A>
): Fx<Checkpoint<Scope, E, A>, Fx<E, A>> =>
  new Checkpoint(scope, body)
