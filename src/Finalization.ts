import { Effect } from './Effect.js'
import { Fx, fx, ok } from './Fx.js'
import { Handle, handle } from './Handler.js'

import { Fail, fail, returnFail } from './Fail.js'

// ----------------------------------------------------------------------
// Guaranteed finalization effects within a finalization boundary

export type Exit<A = unknown, F extends Fail<unknown> = Fail<unknown>> =
  | Success<A>
  | Failure<F>

export interface Success<A> {
  readonly type: 'success'
  readonly value: A
}

export interface Failure<F extends Fail<unknown>> {
  readonly type: 'failure'
  readonly failure: F
}

/**
 * A value paired with cleanup for the enclosing finalization boundary.
 *
 * The finalizer receives the boundary's exit, not the managed value.
 */
export interface Managed<A, E = never> {
  readonly value: A
  readonly finalizer: (exit: Exit) => Fx<E, void>
}

type Finalizer = (exit: Exit) => Fx<unknown, void>

/**
 * Request that a cleanup operation be run when the enclosing finalization boundary exits.
 */
export class Finally extends Effect('fx/Finally')<Finalizer, void> { }

/**
 * Register a cleanup operation to run when the enclosing finalization boundary exits.
 */
export const andFinally = <E>(f: Fx<E, void>): Fx<Finally, void> =>
  new Finally(() => f)

/**
 * Register a cleanup operation that receives the enclosing finalization boundary's exit.
 */
export const andFinallyExit = <E>(
  f: (exit: Exit) => Fx<E, void>
): Fx<Finally, void> =>
  new Finally(exit => f(exit))

/**
 * Run an initial operation, register cleanup for its result, and return it.
 */
export const using = <const IE, const FE, const R>(
  initially: Fx<IE, R>,
  finally_: (r: R) => Fx<FE, void>
): Fx<IE | Finally, R> => fx(function* () {
  const r = yield* initially
  yield* andFinally(finally_(r))
  return r
})

/**
 * Run an initial operation, register exit-aware cleanup for its result, and return it.
 */
export const usingExit = <const IE, const FE, const R>(
  initially: Fx<IE, R>,
  finally_: (r: R, exit: Exit) => Fx<FE, void>
): Fx<IE | Finally, R> => fx(function* () {
  const r = yield* initially
  yield* andFinallyExit(exit => finally_(r, exit))
  return r
})

/**
 * Pair a value with cleanup for a finalization boundary.
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
export const usingManaged = <const IE, const FE, const A>(
  initially: Fx<IE, Managed<A, FE>>
): Fx<IE | Finally, A> => fx(function* () {
  const m = yield* initially
  yield* andFinallyExit(m.finalizer)
  return m.value
})

/**
 * Run a computation and then run its registered cleanup operations.
 */
export const withFinalization = <const E, const A>(f: Fx<E, A>) => fx(function* () {
  const finalizers = [] as Finalizer[]
  const result = yield* f.pipe(
    handle(Finally, finally_ => ok(void finalizers.push(finally_.arg))),
    returnFail
  )

  const failed = Fail.is(result)
  const exit = failed
    ? { type: 'failure', failure: result as Fail<unknown> } satisfies Exit
    : { type: 'success', value: result } satisfies Exit
  const failures = yield* releaseSafely(finalizers, exit)
  if (failures.length > 0)
    return yield* fail(new AggregateError(
      failed ? [result.arg, ...failures] : failures,
      'Resource release failed'
    ))

  return failed ? yield* fail(result.arg) : result
}) as Fx<Handle<E, Finally, Fail<AggregateError>>, A>

const releaseSafely = (resources: readonly Finalizer[], exit: Exit) => fx(function* () {
  const failures = [] as unknown[]
  for (let i = resources.length - 1; i >= 0; --i) {
    const r = yield* returnFail(resources[i](exit))
    if (Fail.is(r)) failures.push(r.arg)
  }
  return failures
})
