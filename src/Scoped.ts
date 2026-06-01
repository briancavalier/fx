import { Fx } from './Fx.js'
import { scope, withScope, type AnyLifetimeScope, type ScopeEffects } from './Scope.js'

declare const ScopedTypeId: unique symbol

type PrivateScope = AnyLifetimeScope & {
  readonly [ScopedTypeId]: true
}

/**
 * Run an Fx in a private named scope.
 *
 * This is an experimental convenience for local lifecycle and control effects.
 * Pass an Fx that requests `currentScope`, or use the callback form when
 * the private scope should be explicit inside the callback.
 */
export function scoped<const E, const A>(
  f: Fx<E, A>
): Fx<ScopeEffects<E, PrivateScope>, A>
export function scoped<const E, const A>(
  f: (scope: PrivateScope) => Fx<E, A>
): Fx<ScopeEffects<E, PrivateScope>, A>
export function scoped<const E, const A>(
  f: Fx<E, A> | ((scope: PrivateScope) => Fx<E, A>)
): Fx<ScopeEffects<E, PrivateScope>, A> {
  const privateScope = scope<PrivateScope>()(Symbol('fx/Scoped/scoped'), { diagnostic: false })
  const scopedFx = typeof f === 'function' ? f(privateScope) : f
  return scopedFx.pipe(withScope(privateScope)) as Fx<ScopeEffects<E, PrivateScope>, A>
}
