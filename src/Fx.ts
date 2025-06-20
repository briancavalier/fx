import { Async } from './Async'
import { provideAll } from './Env'
import { Fail, assert } from './Fail'
import { Task } from './Task'
import { GetHandlerContext } from './internal/HandlerContext'
import * as generator from './internal/generator'
import { Pipeable } from './internal/pipe'
import { RunForkOptions, runFork } from './internal/runFork'
import { TrySync } from './internal/sync'

/**
 * A computation that produces a value of type `A`, and may produce effects of
 * type `E`.
 */
export interface Fx<E, A> extends Pipeable {
  [Symbol.iterator](): Iterator<E, A, unknown>
}

/**
 * Construct an Fx from a generator that uses `yield*` to produce effects.
 */
export const fx: {
  <const E, const A>(f: () => Generator<E, A>): Fx<E, A>
  <const T, const E, const A>(self: T, f: (this: T) => Generator<E, A>): Fx<E, A>
} = function () {
  return arguments.length === 1
    ? new generator.Gen(undefined, arguments[0])
    : new generator.Gen(arguments[0], arguments[1])
}

/**
 * Construct an Fx from a pure value. The returned Fx will produce no effects.
 */
export const ok = <const A>(a: A): Fx<never, A> => new generator.Ok(a)

/**
 * Construct an Fx that produces no effects and returns `undefined`.
 */
export const unit = ok(undefined)

/**
 * Convert an synchronous side-effect function into an Fx. If the function throws,
 * the error will be propagated as a {@link Fail} effect.
 */
export const trySync = <const A>(f: () => A): Fx<Fail<unknown>, A> =>
  new TrySync(f)

/**
 * Convert an synchronous side-effect function into an Fx, asserting that it
 * does not throw. Use {@link trySync} instead, if the function might throw.
 * Thrown errors will not be caught by the Fx runtime, and will crash the process.
 */
export const assertSync = <const A>(f: () => A): Fx<never, A> => assert(trySync(f))

/**
 * Transform the result of an Fx
 */
export const map = <const A, const B>(f: (a: A) => B) =>
  <const E>(x: Fx<E, A>): Fx<E, B> => new generator.Map<E, A, B>(f, x as any) as Fx<E, B>

/**
 * Sequence Fx: the result of the first is used to produce the next.
 */
export const flatMap = <const A, const E2, const B>(f: (a: A) => Fx<E2, B>) =>
  <const E1>(fa: Fx<E1, A>): Fx<E1 | E2, B> => new generator.FlatMap(f, fa as any) as Fx<E1 | E2, B>

/**
 * Sequence Fx: discard the result of the first and return the result of the second.
 */
export const andThen = <const E2, const B>(f: Fx<E2, B>) => flatMap(() => f)

/**
 * Discard the result of the Fx and return the provided value.
 */
export const andReturn = <const B>(b: B) => map(() => b)

/**
 * Perform side effects and return the original value.
 * @example
 *  // Logs "Hello" and returns "Hello"
 *  ok("Hello").pipe(tap(Console.log))
 */
export const tap = <const A, const E2>(f: (a: A) => Fx<E2, void>) =>
  <const E1>(fa: Fx<E1, A>): Fx<E1 | E2, A> => fa.pipe(
    flatMap(a => f(a).pipe(andReturn(a)))
  )

/**
 * Flatten a nested Fx.
 */
export const flatten = <const E1, const E2, const A>(x: Fx<E1, Fx<E2, A>>): Fx<E1 | E2, A> =>
  x.pipe(flatMap(x => x))

/**
 * Execute all the effects of the provided Fx, and return a {@link Task} for its result.
 */
export const runTask = <const R>(f: Fx<Async | GetHandlerContext, R>, { origin = 'fx/runTask', maxConcurrency }: RunForkOptions = {}): Task<R, never> =>
  runFork(f.pipe(provideAll({})), { origin, maxConcurrency })

/**
 * Execute all the effects of the provided Fx, and return a Promise for its result,
 * discarding the ability to cancel the computation.
 */
export const runPromise = <const R>(f: Fx<Async | GetHandlerContext, R>, { origin = 'fx/runPromise', maxConcurrency }: RunForkOptions = {}): Promise<R> =>
  runTask(f, { origin, maxConcurrency }).promise

/**
 * Execute all the effects of the provided Fx, and return its result.
 */
export const run = <const R>(f: Fx<never, R>): R =>
  f.pipe(provideAll({}), f => f[Symbol.iterator]().next().value)

/**
 * Ensures that a resource is acquired, used, and then released,
 * even if an error occurs. Runs the `initially` effect to acquire a resource,
 * passes it to `f`, and guarantees that `andFinally` is run with the
 * resource after `f` returns or throws.
 */
export const bracket = <const IE, const FE, const E, const R, const A>(
  initially: Fx<IE, R>,
  andFinally: (a: R) => Fx<FE, void>,
  f: (a: R) => Fx<E, A>
) => fx(function* () {
  const r = yield* initially
  try {
    return yield* f(r)
  } finally {
    yield* andFinally(r)
  }
})
