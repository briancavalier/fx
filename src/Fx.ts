import { Async } from './Async.js'
import { at } from './Breadcrumb.js'
import { Get, get, provideAll } from './Env.js'
import { Fail, assert } from './Fail.js'
import { HandlerCapture } from './HandlerCapture.js'
import { uninterruptibleMask } from './Interrupt.js'
import type { Interrupt } from './Interrupt.js'
import { Task } from './Task.js'
import { isEffect } from './Effect.js'
import * as generator from './internal/generator.js'
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from './internal/interrupt.js'
import { Pipeable } from './internal/pipe.js'
import { RunForkOptions, runFork } from './internal/runFork.js'
import { TrySync } from './internal/sync.js'
import type { IfAny } from './internal/type.js'

/**
 * A computation that returns a value of type `A` and may request effects `E`.
 *
 * Application programs usually build `Fx` values with {@link fx}, request
 * effects with `yield*`, and then eliminate those effects with handlers before
 * running the program.
 */
export interface Fx<E, A> extends Pipeable {
  [Symbol.iterator](): Iterator<E, A, unknown>
}

/**
 * Construct an Fx from a generator that uses `yield*` to request effects.
 *
 * A generator with a declared runtime parameter receives contextual values from
 * {@link Get}; defaulted contextual parameters are not supported because they
 * have runtime arity 0.
 *
 * @example
 * ```ts
 * const greet = fx(function* () {
 *   const name = yield* askName
 *   return `Hello, ${name}`
 * })
 * ```
 */
export const fx: {
  <const E, const A>(f: () => Generator<E, A>): Fx<E, A>
  <const Ctx extends Record<PropertyKey, unknown>, const E, const A>(f: (ctx: Ctx) => Generator<E, A>): Fx<E | Get<Ctx>, A>
  <const T, const E, const A>(self: T, f: (this: T) => Generator<E, A>): Fx<E, A>
  <const T, const Ctx extends Record<PropertyKey, unknown>, const E, const A>(self: T, f: (this: T, ctx: Ctx) => Generator<E, A>): Fx<E | Get<Ctx>, A>
} = function () {
  const self = arguments.length === 1 ? undefined : arguments[0]
  const f = arguments.length === 1 ? arguments[0] : arguments[1]

  return f.length === 0
    ? new generator.Gen(self, f)
    : new generator.Gen(self, function* (this: unknown) {
      const ctx = yield* get()
      return yield* f.call(this, ctx)
    })
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
 *  ok("Hello").pipe(tap(consoleLog))
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

type UnhandledEffects<E, RuntimeEffects> = Exclude<E, RuntimeEffects>

type UnhandledEffectsError<Effects> = {
  readonly message: 'Cannot run Fx with unhandled effects. Add handlers before run/runPromise/runTask.'
  readonly detail: Effects
}

type RunEffects<E, RuntimeEffects> =
  [IfAny<E, never>] extends [never]
    ? E
    : [UnhandledEffects<E, RuntimeEffects>] extends [never]
      ? E
      : RuntimeEffects | UnhandledEffectsError<UnhandledEffects<E, RuntimeEffects>>

/**
 * Execute a runtime-ready Fx and return a cancellable {@link Task}.
 *
 * Use `runTask` when the caller needs to dispose the running computation or wait
 * for cleanup. All non-runtime effects must be handled before calling it.
 */
export const runTask = <const E, const R>(
  f: Fx<RunEffects<E, Async | HandlerCapture<string> | Interrupt>, R>,
  options: RunForkOptions = {}
): Task<R, never> => {
  return runFork((f as Fx<Async | HandlerCapture<string> | Interrupt, R>).pipe(provideAll({})), {
    ...options,
    origin: options.origin ?? at('fx/runTask', runTask)
  })
}

/**
 * Execute a runtime-ready Fx and return a Promise for its result.
 *
 * This discards explicit cancellation. Use {@link runTask} when the caller needs
 * to cancel or wait for disposal.
 */
export const runPromise = <const E, const R>(
  f: Fx<RunEffects<E, Async | HandlerCapture<string> | Interrupt>, R>,
  options: RunForkOptions = {}
): Promise<R> => {
  return runTask(f as Fx<Async | HandlerCapture<string> | Interrupt, R>, {
    ...options,
    origin: options.origin ?? at('fx/runPromise', runPromise)
  }).promise
}

/**
 * Execute a synchronous Fx and return its result.
 *
 * Use `run` only after handlers have eliminated all effects except
 * {@link Interrupt}. Use {@link runPromise} or {@link runTask} for async
 * programs.
 */
export const run = <const E, const R>(f: Fx<RunEffects<E, Interrupt>, R>): R => {
  return (f as Fx<Interrupt, R>).pipe(provideAll({}), f => {
    const i = f[Symbol.iterator]()
    const masks = new InterruptMaskState()
    let ir = i.next()
    const step = (ir: IteratorResult<Interrupt, R>) => {
      while (!ir.done) {
        if (InterruptMaskBegin.is(ir.value)) {
          masks.mask(ir.value.arg)
          ir = i.next()
        } else if (InterruptMaskEnd.is(ir.value)) {
          masks.unmask(ir.value.arg)
          ir = i.next()
        } else if (isEffect(ir.value)) {
          throw new Error('Unhandled effect in run')
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }
      }
      return ir
    }
    ir = step(ir)
    if (!masks.balanced) {
      const cleanup = i.return?.(ir.value)
      if (cleanup !== undefined) ir = step(cleanup)
    }
    // Handlers such as returnFail can return effects as ordinary values.
    // Those values are not effects that run still needs to interpret.
    if (!isEffect(ir.value)) masks.assertBalanced()
    return ir.value as R
  })
}

/**
 * Acquire a resource, use it, and release it even if use fails or is
 * interrupted.
 *
 * `bracket` is useful for local acquire/use/release flows. For named resource
 * scopes, prefer the helpers in `Finalization`.
 */
export const bracket = <const IE, const FE, const E, const R, const A>(
  initially: Fx<IE, R>,
  andFinally: (a: R) => Fx<FE, void>,
  f: (a: R) => Fx<E, A>
) => uninterruptibleMask(restore => fx(function* () {
  const r = yield* initially
  try {
    return yield* restore(f(r))
  } finally {
    yield* andFinally(r)
  }
}))
