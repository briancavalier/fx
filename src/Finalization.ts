import { ScopedEffect } from './Effect.js'
import { Fx, fx } from './Fx.js'
import { uninterruptible } from './Interrupt.js'
import type { Interrupt } from './Interrupt.js'
import { assertScopeOpen, currentScope, type AnyLifetimeScope, type Exit } from './Scope.js'

// ----------------------------------------------------------------------
// Guaranteed finalization effects within a scope

/**
 * A value paired with cleanup for a scope.
 *
 * The finalizer receives the scope's exit, not the managed value.
 */
export interface Managed<A, E = never> {
  readonly value: A
  readonly finalizer: Finalizer<E>
}

export type Finalizer<E = unknown> = (exit: Exit) => Fx<E, void>

/**
 * Request that a cleanup operation be run when the scope exits.
 *
 * A `withScope(...)` handler interprets `Finally` requests for its matching scope
 * and runs registered finalizers when that scope succeeds, fails, returns,
 * aborts, or is interrupted.
 */
export class Finally<const Scope extends AnyLifetimeScope, E = never> extends ScopedEffect('fx/Finally')<Scope, Finalizer<E>, void> { }

/**
 * Register a cleanup operation to run when the current scope exits.
 *
 * Use this when the finalizer does not need to inspect the scope exit.
 */
export function andFinally<E>(f: Fx<E, void>): Fx<Finally<typeof currentScope, E>, void>
/**
 * Register a cleanup operation that receives the current scope's exit.
 *
 * Use this when cleanup behavior depends on whether the scope succeeded,
 * failed, returned, aborted, or was interrupted.
 */
export function andFinally<E>(f: (exit: Exit) => Fx<E, void>): Fx<Finally<typeof currentScope, E>, void>
export function andFinally<E>(
  f: Fx<E, void> | ((exit: Exit) => Fx<E, void>)
): Fx<Finally<typeof currentScope, E>, void> {
  return new Finally(currentScope, typeof f === 'function' ? f : () => f)
}

/**
 * Register a cleanup operation to run when the named scope exits.
 *
 * Use this when the finalizer does not need to inspect the scope exit.
 */
export function andFinallyIn<const Scope extends AnyLifetimeScope, E>(
  scope: Scope,
  f: Fx<E, void>
): Fx<Finally<Scope, E>, void>
/**
 * Register a cleanup operation that receives the named scope's exit.
 *
 * Use this when cleanup behavior depends on whether the scope succeeded,
 * failed, returned, aborted, or was interrupted.
 */
export function andFinallyIn<const Scope extends AnyLifetimeScope, E>(
  scope: Scope,
  f: (exit: Exit) => Fx<E, void>
): Fx<Finally<Scope, E>, void>
export function andFinallyIn<const Scope extends AnyLifetimeScope, E>(
  scope: Scope,
  f: Fx<E, void> | ((exit: Exit) => Fx<E, void>)
): Fx<Finally<Scope, E>, void> {
  assertScopeOpen(scope)
  return new Finally(scope, typeof f === 'function' ? f : () => f)
}

/**
 * Run an initial operation, register cleanup for its result, and return it.
 *
 * Acquisition and finalizer registration happen in an uninterruptible region so
 * an acquired resource is not left without cleanup.
 */
export const using = <const IE, const FE, const R>(
  initially: Fx<IE, R>,
  finally_: (r: R, exit: Exit) => Fx<FE, void>
): Fx<IE | Finally<typeof currentScope, FE> | Interrupt, R> =>
    usingIn(currentScope, initially, finally_)

/**
 * Run an initial operation, register cleanup for its result in a named scope,
 * and return it.
 *
 * Acquisition and finalizer registration happen in an uninterruptible region so
 * an acquired resource is not left without cleanup.
 */
export const usingIn = <const Scope extends AnyLifetimeScope, const IE, const FE, const R>(
  scope: Scope,
  initially: Fx<IE, R>,
  finally_: (r: R, exit: Exit) => Fx<FE, void>
): Fx<IE | Finally<Scope, FE> | Interrupt, R> => uninterruptible(fx(function* () {
  const r = yield* initially
  yield* andFinallyIn(scope, exit => finally_(r, exit))
  return r
}))

/**
 * Pair a value with cleanup for a named scope.
 */
export const managed = <const A, const E>(
  value: A,
  finalizer: (exit: Exit) => Fx<E, void>
): Managed<A, E> => ({
  value,
  finalizer
})

/**
 * Run an initial operation that returns a managed value, register its cleanup,
 * and return its value.
 *
 * Use this when acquisition naturally returns the value and its finalizer
 * together.
 */
export const usingManaged = <const IE, const FE, const A>(
  initially: Fx<IE, Managed<A, FE>>
): Fx<IE | Finally<typeof currentScope, FE> | Interrupt, A> =>
    usingManagedIn(currentScope, initially)

/**
 * Run an initial operation that returns a managed value, register its cleanup in
 * a named scope, and return its value.
 *
 * Use this when acquisition naturally returns the value and its finalizer
 * together.
 */
export const usingManagedIn = <const Scope extends AnyLifetimeScope, const IE, const FE, const A>(
  scope: Scope,
  initially: Fx<IE, Managed<A, FE>>
): Fx<IE | Finally<Scope, FE> | Interrupt, A> => uninterruptible(fx(function* () {
  const m = yield* initially
  yield* andFinallyIn(scope, m.finalizer)
  return m.value
}))
