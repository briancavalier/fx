import { Fx } from './Fx.js'
import { scope, withScope, type AnyLifetimeScope, type ScopeEffects } from './Scope.js'

declare const ScopedTypeId: unique symbol

type PrivateScope = AnyLifetimeScope & {
  readonly [ScopedTypeId]: true
}

/**
 * Run an Fx in a private named scope.
 *
 * Use `currentScope` inside the Fx to target the private boundary.
 */
export const scoped = <const E, const A>(
  f: Fx<E, A>
): Fx<ScopeEffects<E, PrivateScope>, A> => {
  const privateScope = scope<PrivateScope>()(Symbol('fx/Scoped/scoped'), { diagnostic: false })
  return f.pipe(withScope(privateScope)) as Fx<ScopeEffects<E, PrivateScope>, A>
}
