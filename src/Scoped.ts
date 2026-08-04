import { Fx } from './Fx.js'
import { inScope } from './Scope.js'

/**
 * Run an Fx in a private scope.
 */
export const scoped = <const E, const A>(
  f: Fx<E, A>
): Fx<E, A> =>
  inScope({ diagnostic: false }, f)
