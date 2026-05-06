import { Async } from './Async.js'
import { Breadcrumb, at, indexed } from './Breadcrumb.js'
import { Effect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, flatMap, fx, ok } from './Fx.js'
import { Handle } from './Handler.js'
import { Scoped, captureScoped, handleScoped, scoped, withContext } from './Scoped.js'
import { Task, wait as waitTask } from './Task.js'
import { Semaphore } from './internal/Semaphore.js'
import { acquireAndRunFork } from './internal/runFork.js'

/**
 * Request that a computation be started concurrently, returning a {@link Task}
 * handle for the running computation.
 */
export class Fork extends Effect('fx/Concurrent/Fork')<ForkContext, Task<unknown, unknown>> { }

export interface ForkContext {
  readonly fx: Fx<unknown, unknown>
  readonly origin: Breadcrumb
}

/**
 * Request that a group of computations be run concurrently in a structured
 * scope, returning all results directly.
 *
 * The request describes structured concurrency. A handler decides how the
 * children are scheduled and how failures cancel siblings.
 */
export class All<const Fxs extends readonly Fx<unknown, unknown>[]> extends Effect('fx/Concurrent/All')<ConcurrentContext<Fxs>, {
  readonly [K in keyof Fxs]: ResultOf<Fxs[K]>
}> { }

/**
 * Request that a group of computations be raced in a structured scope,
 * returning the first settled result directly.
 *
 * The request describes structured concurrency. A handler decides how the
 * children are scheduled and how losing children are cancelled.
 */
export class Race<const Fxs extends readonly Fx<unknown, unknown>[]> extends Effect('fx/Concurrent/Race')<ConcurrentContext<Fxs>, ResultOf<Fxs[number]>> { }

/**
 * Context shared by structured concurrency requests.
 */
export interface ConcurrentContext<Fxs extends readonly Fx<unknown, unknown>[]> {
  readonly fxs: Fxs
  readonly origin: Breadcrumb
}

/**
 * Start an Fx concurrently and return a {@link Task} handle.
 *
 * Use `fork` when the caller needs explicit control over a child computation's
 * lifetime. Use {@link all} or {@link race} when the caller only needs the
 * structured result.
 *
 * @example
 * const task = yield* fork(fetchUser)
 * const user = yield* wait(task)
 */
export const fork = <const E, const A>(
  f: Fx<E, A>,
  origin: Breadcrumb = at('fx/Concurrent/fork', fork)
): Fx<Exclude<E, Async | Fail<any>> | Fork | Scoped<'fx/Concurrent/Fork'>, Task<A, ErrorsOf<E>>> =>
  scoped('fx/Concurrent/Fork', f, fx =>
    ok(new Fork({ fx, origin }) as Fx<Fork, Task<A, ErrorsOf<E>>>)
  ) as Fx<Exclude<E, Async | Fail<any>> | Fork | Scoped<'fx/Concurrent/Fork'>, Task<A, ErrorsOf<E>>>

/**
 * Start a tuple of Fx computations concurrently and return their {@link Task}
 * handles.
 *
 * `forkEach` is the explicit handle-based form of concurrency. The caller owns
 * each returned task and decides when to wait for or dispose it.
 */
export const forkEach = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: Fxs,
  origin: Breadcrumb = at('fx/Concurrent/forkEach', forkEach)
) => fx(function* () {
  const ps = [] as Task<unknown, unknown>[]
  for (let i = 0; i < fxs.length; i++) ps.push(yield* fork(fxs[i], indexed(origin, i)))
  return ps
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, {
  readonly [K in keyof Fxs]: Task<ResultOf<Fxs[K]>, ErrorsOf<EffectsOf<Fxs[K]>>>
}>

/**
 * Run a tuple of Fx computations concurrently in a structured scope, returning
 * the tuple of child results directly.
 *
 * @example
 * const [user, posts] = yield* all([fetchUser, fetchPosts])
 */
export const all = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: Fxs,
  origin: Breadcrumb = at('fx/Concurrent/all', all)
) => fx(function* () {
  const context = yield* captureScoped('fx/Concurrent/All')
  return yield* new All({
    fxs: fxs.map(f => withContext(context, f)) as unknown as Fxs,
    origin
  })
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | All<Fxs> | Scoped<'fx/Concurrent/All'>, {
  readonly [K in keyof Fxs]: ResultOf<Fxs[K]>
}>

/**
 * Race a tuple of Fx computations in a structured scope, returning the first
 * child result or failure to settle.
 *
 * @example
 * const value = yield* race([primary, fallback])
 */
export const race = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: Fxs,
  origin: Breadcrumb = at('fx/Concurrent/race', race)
) => fx(function* () {
  const context = yield* captureScoped('fx/Concurrent/Race')
  return yield* new Race({
    fxs: fxs.map(f => withContext(context, f)) as unknown as Fxs,
    origin
  })
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Race<Fxs> | Scoped<'fx/Concurrent/Race'>, ResultOf<Fxs[number]>>

/**
 * Handle All by running all child computations concurrently in a structured
 * scope. The first child failure fails the parent and cancels siblings.
 *
 * @example
 * await all([fetchUser, fetchPosts]).pipe(
 *   defaultAll,
 *   unbounded,
 *   runPromise
 * )
 */
export const defaultAll = <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, AnyAll, DefaultAllEffects<E>>, Scoped<'fx/Concurrent/All'>>, A> =>
  f.pipe(handleScoped('fx/Concurrent/All', All, runAll)) as Fx<Handle<Handle<E, AnyAll, DefaultAllEffects<E>>, Scoped<'fx/Concurrent/All'>>, A>

/**
 * Handle Race by running child computations concurrently in a structured scope.
 * The first child to settle wins and all losers are cancelled.
 *
 * @example
 * await race([primary, fallback]).pipe(
 *   defaultRace,
 *   unbounded,
 *   runPromise
 * )
 */
export const defaultRace = <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, AnyRace, DefaultRaceEffects<E>>, Scoped<'fx/Concurrent/Race'>>, A> =>
  f.pipe(handleScoped('fx/Concurrent/Race', Race, runRace)) as Fx<Handle<Handle<E, AnyRace, DefaultRaceEffects<E>>, Scoped<'fx/Concurrent/Race'>>, A>

/**
 * Handle Fork by running at most `maxConcurrency` forked computations at once.
 *
 * Structured handlers such as {@link defaultAll} and {@link defaultRace}
 * elaborate into Fork requests, so `bounded` also limits their child
 * concurrency.
 */
export const bounded = (maxConcurrency: number) => <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, Fork>, Scoped<'fx/Concurrent/Fork'>> | Scoped<'fx/Concurrent/Fork'>, A> =>
  scoped('fx/Concurrent/Fork', f, fx =>
    ok(fx.pipe(handleScoped('fx/Concurrent/Fork', Fork, runForkWith(new Semaphore(maxConcurrency)))))
  ) as Fx<Handle<Handle<E, Fork>, Scoped<'fx/Concurrent/Fork'>> | Scoped<'fx/Concurrent/Fork'>, A>

/**
 * Handle Fork by running forked computations without a concurrency limit.
 */
export const unbounded = bounded(Infinity)

const runForkWith = (s: Semaphore) =>
  (f: ForkContext): Fx<never, Task<unknown, unknown>> =>
    ok(acquireAndRunFork(f, s))

const runAll = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  a: ConcurrentContext<Fxs>
): Fx<Fork | Async | ErrorsOf<EffectsOf<Fxs[number]>>, {
  readonly [K in keyof Fxs]: ResultOf<Fxs[K]>
}> =>
  forkEach(a.fxs, a.origin).pipe(
    flatMap(tasks => waitTask(taskAll(tasks)))
  ) as Fx<Fork | Async | ErrorsOf<EffectsOf<Fxs[number]>>, {
    readonly [K in keyof Fxs]: ResultOf<Fxs[K]>
  }>

const runRace = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  r: ConcurrentContext<Fxs>
): Fx<Fork | Async | ErrorsOf<EffectsOf<Fxs[number]>>, ResultOf<Fxs[number]>> =>
  forkEach(r.fxs, r.origin).pipe(
    flatMap(tasks => waitTask(taskRace(tasks)))
  ) as Fx<Fork | Async | ErrorsOf<EffectsOf<Fxs[number]>>, ResultOf<Fxs[number]>>

export type EffectsOf<F> = F extends Fx<infer E, unknown> ? E : never
export type ResultOf<F> = F extends Fx<unknown, infer A> ? A : never
export type ErrorsOf<E> = Extract<E, Fail<any>>

type AnyAll = All<any>
type AnyRace = Race<any>
type EffectsOfAll<E> = E extends All<infer Fxs> ? EffectsOf<Fxs[number]> : never
type EffectsOfRace<E> = E extends Race<infer Fxs> ? EffectsOf<Fxs[number]> : never
type DefaultAllEffects<E> = Fork | Async | ErrorsOf<EffectsOfAll<E>>
type DefaultRaceEffects<E> = Fork | Async | ErrorsOf<EffectsOfRace<E>>
type TaskResult<P> = P extends Task<infer A, unknown> ? A : never
type TaskErrors<P> = P extends Task<unknown, infer E> ? E : never

const taskAll = <Tasks extends readonly Task<unknown, unknown>[]>(tasks: Tasks) => {
  const d = new DisposeAll(tasks)
  const p = Promise.all(tasks.map(t => t.promise)).finally(() => { d[Symbol.dispose]() })
  return new Task(p, d) as Task<{ readonly [K in keyof Tasks]: TaskResult<Tasks[K]> }, TaskErrors<Tasks[number]>>
}

const taskRace = <Tasks extends readonly Task<unknown, unknown>[]>(tasks: Tasks) => {
  const d = new DisposeAll(tasks)
  const p = Promise.race(tasks.map(t => t.promise)).finally(() => { d[Symbol.dispose]() })
  return new Task(p, d) as Task<TaskResult<Tasks[number]>, TaskErrors<Tasks[number]>>
}

class DisposeAll {
  constructor(private readonly tasks: Iterable<Task<unknown, unknown>>) { }
  [Symbol.dispose]() { for (const t of this.tasks) t[Symbol.dispose]() }
}
