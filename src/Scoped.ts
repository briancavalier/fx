import { Fx } from './Fx.js'
import { scope, withScope, type AnyLifetimeScope, type ScopeEffects } from './Scope.js'
import { collectFrom, type ExcludeYieldFrom, type Yielding } from './YieldFrom.js'

/**
 * Run an Fx in a private named scope.
 *
 * This is an experimental convenience for local lifecycle and control effects.
 * Pass an Fx that requests `currentScope`, or use the callback form when
 * the private scope should be explicit inside the callback.
 */
export function scoped<const E, const A>(
  f: Fx<E, A>
): Fx<ScopeEffects<E, AnyLifetimeScope>, A>
export function scoped<const E, const A>(
  f: (scope: AnyLifetimeScope) => Fx<E, A>
): Fx<ScopeEffects<E, AnyLifetimeScope>, A>
export function scoped<const E, const A>(
  f: Fx<E, A> | ((scope: AnyLifetimeScope) => Fx<E, A>)
): Fx<ScopeEffects<E, AnyLifetimeScope>, A> {
  const privateScope = scope(Symbol('fx/Scoped/scoped'), { diagnostic: false })
  const scopedFx = typeof f === 'function' ? f(privateScope) : f
  return scopedFx.pipe(withScope(privateScope)) as Fx<ScopeEffects<E, AnyLifetimeScope>, A>
}

/**
 * Run an Fx in a private yielding scope and collect all yielded values.
 *
 * The scoped yield channel is created and handled inside this boundary, so the
 * private scope does not escape in the returned effect type.
 */
export function collectScoped<const Out>(): <const E, const A>(
  f: (scope: AnyLifetimeScope & Yielding<Out, void>) => Fx<E, A>
) => Fx<
  ExcludeYieldFrom<ScopeEffects<E, AnyLifetimeScope & Yielding<Out, void>>, AnyLifetimeScope & Yielding<Out, void>>,
  readonly [A, readonly Out[]]
>
export function collectScoped<const Out, const E, const A>(
  f: (scope: AnyLifetimeScope & Yielding<Out, void>) => Fx<E, A>
): Fx<
  ExcludeYieldFrom<ScopeEffects<E, AnyLifetimeScope & Yielding<Out, void>>, AnyLifetimeScope & Yielding<Out, void>>,
  readonly [A, readonly Out[]]
>
export function collectScoped<const Out, const E, const A>(
  f?: (scope: AnyLifetimeScope & Yielding<Out, void>) => Fx<E, A>
) {
  if (f === undefined) return (f: (scope: AnyLifetimeScope & Yielding<Out, void>) => Fx<E, A>) => collectScoped(f)

  const privateScope = scope<Yielding<Out>>()(
    Symbol('fx/Scoped/collectScoped'),
    { diagnostic: false }
  )
  return f(privateScope).pipe(
    withScope(privateScope),
    collectFrom(privateScope)
  ) as Fx<
    ExcludeYieldFrom<ScopeEffects<E, AnyLifetimeScope & Yielding<Out, void>>, AnyLifetimeScope & Yielding<Out, void>>,
    readonly [A, readonly Out[]]
  >
}
