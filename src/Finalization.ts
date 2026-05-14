import { Effect } from './Effect.js'
import { Fx, fx } from './Fx.js'
import { uninterruptible } from './Interrupt.js'
import type { Interrupt } from './Interrupt.js'
import type { Exit } from './Scope.js'

// ----------------------------------------------------------------------
// Guaranteed finalization effects within a named scope

/**
 * A value paired with cleanup for a named scope.
 *
 * The finalizer receives the scope's exit, not the managed value.
 */
export interface Managed<A, E = never> {
  readonly value: A
  readonly finalizer: (exit: Exit) => Fx<E, void>
}

export type Finalizer = (exit: Exit) => Fx<unknown, void>

/**
 * Request that a cleanup operation be run when the named scope exits.
 */
export class Finally<const Scope extends string> extends Effect('fx/Finally')<{
  readonly scope: Scope
  readonly finalizer: Finalizer
}, void> { }

/**
 * Register a cleanup operation to run when the named scope exits.
 */
export const andFinally = <const Scope extends string, E>(
  scope: Scope,
  f: Fx<E, void>
): Fx<Finally<Scope>, void> =>
  new Finally({ scope, finalizer: () => f })

/**
 * Register a cleanup operation that receives the named scope's exit.
 */
export const andFinallyExit = <const Scope extends string, E>(
  scope: Scope,
  f: (exit: Exit) => Fx<E, void>
): Fx<Finally<Scope>, void> =>
  new Finally({ scope, finalizer: exit => f(exit) })

/**
 * Run an initial operation, register cleanup for its result, and return it.
 */
export const using = <const Scope extends string, const IE, const FE, const R>(
  scope: Scope,
  initially: Fx<IE, R>,
  finally_: (r: R) => Fx<FE, void>
): Fx<IE | Finally<Scope> | Interrupt, R> => uninterruptible(fx(function* () {
  const r = yield* initially
  yield* andFinally(scope, finally_(r))
  return r
}))

/**
 * Run an initial operation, register exit-aware cleanup for its result, and return it.
 */
export const usingExit = <const Scope extends string, const IE, const FE, const R>(
  scope: Scope,
  initially: Fx<IE, R>,
  finally_: (r: R, exit: Exit) => Fx<FE, void>
): Fx<IE | Finally<Scope> | Interrupt, R> => uninterruptible(fx(function* () {
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
 * Run an initial operation that returns a managed value, register its cleanup, and return its value.
 */
export const usingManaged = <const Scope extends string, const IE, const FE, const A>(
  scope: Scope,
  initially: Fx<IE, Managed<A, FE>>
): Fx<IE | Finally<Scope> | Interrupt, A> => uninterruptible(fx(function* () {
  const m = yield* initially
  yield* andFinallyExit(scope, m.finalizer)
  return m.value
}))
