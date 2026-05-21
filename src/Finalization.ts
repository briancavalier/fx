import { ScopedEffect } from './Effect.js'
import { Fx, fx } from './Fx.js'
import { uninterruptible } from './Interrupt.js'
import type { Interrupt } from './Interrupt.js'
import type { AnyScope, Exit } from './Scope.js'

// ----------------------------------------------------------------------
// Guaranteed finalization effects within a named scope

/**
 * A value paired with cleanup for a named scope.
 *
 * The finalizer receives the scope's exit, not the managed value.
 */
export interface Managed<A, E = never> {
  readonly value: A
  readonly finalizer: Finalizer<E>
}

export type Finalizer<E = unknown> = (exit: Exit) => Fx<E, void>

/**
 * Request that a cleanup operation be run when the named scope exits.
 *
 * A `withScope(...)` handler interprets `Finally` requests for its matching scope
 * and runs registered finalizers when that scope succeeds, fails, returns,
 * aborts, or is interrupted.
 */
export class Finally<const Scope extends AnyScope, E = never> extends ScopedEffect('fx/Finally')<Scope, Finalizer<E>, void> { }

/**
 * Register a cleanup operation to run when the named scope exits.
 *
 * Use this when the finalizer does not need to inspect the scope exit.
 */
export const andFinally = <const Scope extends AnyScope, E>(
  scope: Scope,
  f: Fx<E, void>
): Fx<Finally<Scope, E>, void> =>
  new Finally(scope, () => f)

/**
 * Register a cleanup operation that receives the named scope's exit.
 *
 * Use this when cleanup behavior depends on whether the scope succeeded,
 * failed, returned, aborted, or was interrupted.
 */
export const andFinallyExit = <const Scope extends AnyScope, E>(
  scope: Scope,
  f: (exit: Exit) => Fx<E, void>
): Fx<Finally<Scope, E>, void> =>
  new Finally(scope, f)

/**
 * Run an initial operation, register cleanup for its result, and return it.
 *
 * Acquisition and finalizer registration happen in an uninterruptible region so
 * an acquired resource is not left without cleanup.
 */
export const using = <const Scope extends AnyScope, const IE, const FE, const R>(
  scope: Scope,
  initially: Fx<IE, R>,
  finally_: (r: R, exit: Exit) => Fx<FE, void>
): Fx<IE | Finally<Scope, FE> | Interrupt, R> => uninterruptible(fx(function* () {
  const r = yield* initially
  yield* andFinallyExit(scope, exit => finally_(r, exit))
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
export const usingManaged = <const Scope extends AnyScope, const IE, const FE, const A>(
  scope: Scope,
  initially: Fx<IE, Managed<A, FE>>
): Fx<IE | Finally<Scope, FE> | Interrupt, A> => uninterruptible(fx(function* () {
  const m = yield* initially
  yield* andFinallyExit(scope, m.finalizer)
  return m.value
}))
