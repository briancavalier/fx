import { Async } from './Async.js'
import { at, indexed } from './Breadcrumb.js'
import { Effect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, flatMap, flatten, fx, ok } from './Fx.js'
import { Handle } from './Handler.js'
import { HandlerCapture, handleCaptured, mapCapturedHandlers, withCapturedHandlers } from './HandlerCapture.js'
import { Task, wait as waitTask } from './Task.js'
import type { TraceFrameKind, TraceOptions, TraceOrigin } from './Trace.js'
import { Trace, captureTrace } from './Trace.js'
import { Semaphore } from './internal/Semaphore.js'
import { acquireAndRunFork } from './internal/runFork.js'
import { currentRuntimeContext } from './internal/runtimeContext.js'

/**
 * Request that a computation be started concurrently.
 *
 * A `Fork` request returns a {@link Task} handle. The scheduling policy is
 * supplied by handlers such as {@link bounded} or {@link unbounded}.
 */
export class Fork extends Effect('fx/Concurrent/Fork')<ForkContext, Task<unknown, unknown>> { }

export interface ForkContext extends TraceOrigin {
  readonly fx: Fx<unknown, unknown>
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
export interface ConcurrentContext<Fxs extends readonly Fx<unknown, unknown>[]> extends TraceOrigin {
  readonly fxs: Fxs
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
  options?: TraceOptions
): Fx<Exclude<E, Async | Fail<any>> | Fork | HandlerCapture<'fx/Concurrent/Fork'>, Task<A, ErrorsOf<E>>> => {
  const trace = traceOrigin(options, 'fx/Concurrent/fork', fork, 'fork')
  return withCapturedHandlers('fx/Concurrent/Fork', f).pipe(
    flatMap(fx => new Fork({ fx, ...trace }) as Fx<Fork, Task<A, ErrorsOf<E>>>)
  ) as Fx<Exclude<E, Async | Fail<any>> | Fork | HandlerCapture<'fx/Concurrent/Fork'>, Task<A, ErrorsOf<E>>>
}

/**
 * Start a tuple of Fx computations concurrently and return their {@link Task}
 * handles.
 *
 * `forkEach` is the explicit handle-based form of concurrency. The caller owns
 * each returned task and decides when to wait for or interrupt it.
 */
export const forkEach = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: Fxs,
  options?: TraceOptions
) => fx(function* () {
  const parent = traceOrigin(options, 'fx/Concurrent/forkEach', forkEach, 'fork')
  const ps = [] as Task<unknown, unknown>[]
  const kind = childFrameKind(parent.trace)
  for (let i = 0; i < fxs.length; i++) {
    ps.push(yield* fork(fxs[i], childTraceOrigin(parent, i, kind)))
  }
  return ps
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, {
  readonly [K in keyof Fxs]: Task<ResultOf<Fxs[K]>, ErrorsOf<EffectsOf<Fxs[K]>>>
}>

/**
 * Request that a tuple of Fx computations run concurrently in a structured
 * scope, returning the tuple of child results directly.
 *
 * Pair `all` with {@link defaultAll} and a fork scheduler such as
 * {@link bounded} or {@link unbounded}.
 *
 * @example
 * const [user, posts] = yield* all([fetchUser, fetchPosts])
 */
export const all = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: Fxs,
  options?: TraceOptions
) => {
  const trace = traceOrigin(options, 'fx/Concurrent/all', all, 'all')
  return mapCapturedHandlers('fx/Concurrent/All', fxs).pipe(
    flatMap(fxs => new All({
      fxs: fxs as unknown as Fxs,
      ...trace
    }))
  ) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | All<Fxs> | HandlerCapture<'fx/Concurrent/All'>, {
    readonly [K in keyof Fxs]: ResultOf<Fxs[K]>
  }>
}

/**
 * Map an iterable to child computations and run them concurrently in input
 * order.
 *
 * Pair `mapAll` with {@link defaultAll} and a fork scheduler such as
 * {@link bounded} or {@link unbounded}.
 *
 * @example
 * const users = yield* mapAll(userIds, id => fetchUser(id))
 */
export const mapAll = <const A, const E, const B>(
  items: Iterable<A>,
  f: (item: A, index: number) => Fx<E, B>,
  options?: TraceOptions
): Fx<Exclude<E, Async | Fail<any>> | All<readonly Fx<E, B>[]> | HandlerCapture<'fx/Concurrent/All'>, readonly B[]> =>
  all(Array.from(items, f) as readonly Fx<E, B>[], options) as Fx<Exclude<E, Async | Fail<any>> | All<readonly Fx<E, B>[]> | HandlerCapture<'fx/Concurrent/All'>, readonly B[]>

/**
 * Request that a tuple of Fx computations race in a structured scope.
 *
 * Pair `race` with {@link firstSettled} for first-settled semantics or
 * {@link firstSuccess} when failed children should be ignored until all fail.
 *
 * @example
 * const value = yield* race([primary, fallback])
 */
export const race = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: Fxs,
  options?: TraceOptions
) => {
  const trace = traceOrigin(options, 'fx/Concurrent/race', race, 'race')
  return mapCapturedHandlers('fx/Concurrent/Race', fxs).pipe(
    flatMap(fxs => new Race({
      fxs: fxs as unknown as Fxs,
      ...trace
    }))
  ) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Race<Fxs> | HandlerCapture<'fx/Concurrent/Race'>, ResultOf<Fxs[number]>>
}

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
export const defaultAll = <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, AnyAll, DefaultAllEffects<E>>, HandlerCapture<'fx/Concurrent/All'>>, A> =>
  f.pipe(handleCaptured('fx/Concurrent/All', All, runAll)) as Fx<Handle<Handle<E, AnyAll, DefaultAllEffects<E>>, HandlerCapture<'fx/Concurrent/All'>>, A>

/**
 * Handle Race by running child computations concurrently in a structured scope.
 * The first child to settle wins and all losers are cancelled.
 *
 * @example
 * await race([primary, fallback]).pipe(
 *   firstSettled,
 *   unbounded,
 *   runPromise
 * )
 */
export const firstSettled = <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, AnyRace, DefaultRaceEffects<E>>, HandlerCapture<'fx/Concurrent/Race'>>, A> =>
  f.pipe(handleCaptured('fx/Concurrent/Race', Race, runRace)) as Fx<Handle<Handle<E, AnyRace, DefaultRaceEffects<E>>, HandlerCapture<'fx/Concurrent/Race'>>, A>

/**
 * Handle Race by running child computations concurrently and returning the
 * first successful result. Child failures are ignored until every child has
 * failed, at which point the parent fails with {@link RaceAllFailed}.
 *
 * @example
 * await race([primary, replica, cache]).pipe(
 *   firstSuccess,
 *   unbounded,
 *   runPromise
 * )
 */
export const firstSuccess = <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, AnyRace, FirstSuccessRaceEffects<E>>, HandlerCapture<'fx/Concurrent/Race'>>, A> =>
  f.pipe(handleCaptured('fx/Concurrent/Race', Race, runFirstSuccessRace)) as Fx<Handle<Handle<E, AnyRace, FirstSuccessRaceEffects<E>>, HandlerCapture<'fx/Concurrent/Race'>>, A>

/**
 * Failure returned by {@link firstSuccess} when every raced child fails.
 */
export class RaceAllFailed<Errors extends readonly unknown[]> extends Error {
  readonly name = 'RaceAllFailed'
  declare readonly code: 'FX_RACE_ALL_FAILED'
  readonly errors!: Errors

  constructor(errors: Errors) {
    super('All raced computations failed')
    Object.defineProperty(this, 'code', {
      value: 'FX_RACE_ALL_FAILED',
      enumerable: false,
      writable: false,
      configurable: true
    })
    Object.defineProperty(this, 'errors', {
      value: errors,
      enumerable: false,
      writable: false,
      configurable: true
    })
  }
}

/**
 * Handle Fork by running at most `maxConcurrency` forked computations at once.
 *
 * Structured handlers such as {@link defaultAll} and {@link firstSettled}
 * elaborate into Fork requests, so `bounded` also limits their child
 * concurrency.
 *
 * @example
 * ```ts
 * program.pipe(defaultAll, bounded(4), runPromise)
 * ```
 */
export const bounded = (maxConcurrency: number) => <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, Fork>, HandlerCapture<'fx/Concurrent/Fork'>> | HandlerCapture<'fx/Concurrent/Fork'>, A> =>
  withCapturedHandlers('fx/Concurrent/Fork', f).pipe(
    flatMap(fx =>
      ok(fx.pipe(handleCaptured('fx/Concurrent/Fork', Fork, runForkWith(new Semaphore(maxConcurrency)))))
    ),
    flatten
  ) as Fx<Handle<Handle<E, Fork>, HandlerCapture<'fx/Concurrent/Fork'>> | HandlerCapture<'fx/Concurrent/Fork'>, A>

/**
 * Handle Fork by running forked computations without a concurrency limit.
 */
export const unbounded = bounded(Infinity)

const runForkWith = (s: Semaphore) =>
  (fork: Fork): Fx<never, Task<unknown, unknown>> =>
    ok(acquireAndRunFork(fork.arg, s))

const childFrameKind = (trace: Trace | undefined) =>
  trace?.frame.kind === 'all' || trace?.frame.kind === 'race' ? trace.frame.kind : 'fork'

const traceOrigin = (
  options: TraceOptions | undefined,
  message: string,
  caller: Function,
  kind: TraceFrameKind
): TraceOrigin => {
  const origin = options?.origin ?? at(message, caller)
  const trace = options?.trace ?? captureTrace(origin, undefined, { kind })
  return { origin, trace }
}

const childTraceOrigin = (parent: TraceOrigin, index: number, kind: TraceFrameKind): TraceOrigin => {
  const origin = indexed(parent.origin, index)
  return { origin, trace: captureTrace(origin, parent.trace, { kind, index }) }
}

const runAll = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  all: All<Fxs>
): Fx<Fork | Async | ErrorsOf<EffectsOf<Fxs[number]>>, {
  readonly [K in keyof Fxs]: ResultOf<Fxs[K]>
}> =>
  forkEach(all.arg.fxs, all.arg).pipe(
    flatMap(tasks => waitTask(taskAll(tasks)))
  ) as Fx<Fork | Async | ErrorsOf<EffectsOf<Fxs[number]>>, {
    readonly [K in keyof Fxs]: ResultOf<Fxs[K]>
  }>

const runRace = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  race: Race<Fxs>
): Fx<Fork | Async | ErrorsOf<EffectsOf<Fxs[number]>>, ResultOf<Fxs[number]>> =>
  forkEach(race.arg.fxs, race.arg).pipe(
    flatMap(tasks => waitTask(taskRace(tasks)))
  ) as Fx<Fork | Async | ErrorsOf<EffectsOf<Fxs[number]>>, ResultOf<Fxs[number]>>

const runFirstSuccessRace = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  race: Race<Fxs>
): Fx<Fork | Async | FirstSuccessRaceFailure<Race<Fxs>>, ResultOf<Fxs[number]>> =>
  forkEach(race.arg.fxs, race.arg).pipe(
    flatMap(tasks => waitTask(taskFirstSuccess(tasks)))
  ) as Fx<Fork | Async | FirstSuccessRaceFailure<Race<Fxs>>, ResultOf<Fxs[number]>>

export type EffectsOf<F> = F extends Fx<infer E, unknown> ? E : never
export type ResultOf<F> = F extends Fx<unknown, infer A> ? A : never
export type ErrorsOf<E> = Extract<E, Fail<any>>

type AnyAll = All<any>
type AnyRace = Race<any>
type EffectsOfAll<E> = E extends All<infer Fxs> ? EffectsOf<Fxs[number]> : never
type EffectsOfRace<E> = E extends Race<infer Fxs> ? EffectsOf<Fxs[number]> : never
type DefaultAllEffects<E> = Fork | Async | ErrorsOf<EffectsOfAll<E>>
type DefaultRaceEffects<E> = Fork | Async | ErrorsOf<EffectsOfRace<E>>
type FirstSuccessRaceEffects<E> = Fork | Async | FirstSuccessRaceFailure<E>
type FirstSuccessRaceFailure<E> = E extends Race<infer Fxs>
  ? EveryFxCanFail<Fxs> extends true ? Fail<RaceAllFailed<FailuresOfFxs<Fxs>>> : never
  : never
type EveryFxCanFail<Fxs extends readonly Fx<unknown, unknown>[]> = Fxs extends readonly []
  ? true
  : number extends Fxs['length']
  ? true
  : Fxs extends readonly [infer F, ...infer Rest]
  ? F extends Fx<unknown, unknown>
  ? [FailuresOfFx<F>] extends [never]
  ? false
  : Rest extends readonly Fx<unknown, unknown>[] ? EveryFxCanFail<Rest> : true
  : false
  : true
type FailuresOfFxs<Fxs extends readonly Fx<unknown, unknown>[]> = {
  readonly [K in keyof Fxs]: FailuresOfFx<Fxs[K]>
}
type FailuresOfFx<F> = FailureOf<ErrorsOf<EffectsOf<F>>>
type FailureOf<E> = E extends Fail<infer F> ? F : never
type TaskResult<P> = P extends Task<infer A, unknown> ? A : never
type TaskErrors<P> = P extends Task<unknown, infer E> ? E : never
type TaskErrorsOf<Tasks extends readonly Task<unknown, unknown>[]> = {
  readonly [K in keyof Tasks]: TaskErrors<Tasks[K]>
}

const taskAll = <Tasks extends readonly Task<unknown, unknown>[]>(tasks: Tasks) => {
  tasks.forEach(t => t._markHandled())
  const d = new InterruptAll(tasks)
  const p = Promise.all(tasks.map(t => t.promise)).then(
    async value => {
      const cleanupFailures = await d.interrupt()
      if (cleanupFailures.length > 0) throw resourceReleaseFailed(cleanupFailures)
      return value
    },
    async failure => {
      const cleanupFailures = await d.interrupt()
      if (cleanupFailures.length > 0) throw resourceReleaseFailed([failure, ...cleanupFailures])
      throw failure
    }
  )
  return new Task(p, reason => { void d.interrupt(reason) }, currentRuntimeContext(), d.interrupted) as Task<{ readonly [K in keyof Tasks]: TaskResult<Tasks[K]> }, TaskErrors<Tasks[number]>>
}

const taskRace = <Tasks extends readonly Task<unknown, unknown>[]>(tasks: Tasks) => {
  tasks.forEach(t => t._markHandled())
  const d = new InterruptAll(tasks)
  const p = Promise.race(tasks.map(t => t.promise)).then(
    async value => {
      const cleanupFailures = await d.interrupt()
      if (cleanupFailures.length > 0) throw resourceReleaseFailed(cleanupFailures)
      return value as TaskResult<Tasks[number]>
    },
    async failure => {
      const cleanupFailures = await d.interrupt()
      if (cleanupFailures.length > 0) throw resourceReleaseFailed([failure, ...cleanupFailures])
      throw failure
    }
  )
  return new Task(p, reason => { void d.interrupt(reason) }, currentRuntimeContext(), d.interrupted) as Task<TaskResult<Tasks[number]>, TaskErrors<Tasks[number]>>
}

const taskFirstSuccess = <Tasks extends readonly Task<unknown, unknown>[]>(tasks: Tasks) => {
  tasks.forEach(t => t._markHandled())
  const d = new InterruptAll(tasks)
  const p = firstSuccessfulPromise(tasks).then(
    async value => {
      const cleanupFailures = await d.interrupt()
      if (cleanupFailures.length > 0) throw resourceReleaseFailed(cleanupFailures)
      return value
    },
    async failure => {
      const cleanupFailures = await d.interrupt()
      if (cleanupFailures.length > 0) throw resourceReleaseFailed([failure, ...cleanupFailures])
      throw failure
    }
  )
  return new Task(p, reason => { void d.interrupt(reason) }, currentRuntimeContext(), d.interrupted) as Task<TaskResult<Tasks[number]>, RaceAllFailed<TaskErrorsOf<Tasks>>>
}

const firstSuccessfulPromise = async <Tasks extends readonly Task<unknown, unknown>[]>(
  tasks: Tasks
): Promise<TaskResult<Tasks[number]>> => {
  const pending = tasks.map((task, index) =>
    task.promise.then(
      value => ({ type: 'success' as const, index, value }),
      failure => ({ type: 'failure' as const, index, failure })
    )
  )

  const failures = [] as unknown[]
  while (pending.length > 0) {
    const { position, result } = await Promise.race(pending.map((p, position) =>
      p.then(result => ({ position, result }))
    ))

    void pending.splice(position, 1)
    if (result.type === 'success') return result.value as TaskResult<Tasks[number]>

    failures[result.index] = result.failure
  }

  throw new RaceAllFailed(failures as TaskErrorsOf<Tasks>)
}

class InterruptAll {
  private readonly interruptedResolver = Promise.withResolvers<void>()
  readonly interrupted = this.interruptedResolver.promise
  private interruptedPromise?: Promise<readonly unknown[]>

  constructor(private readonly tasks: Iterable<Task<unknown, unknown>>) {
    this.interrupted.catch(() => { })
  }

  interrupt(reason?: unknown) {
    this.interruptedPromise ??= Promise.allSettled([...this.tasks].map(t => t.interrupt(reason))).then(
      results => {
        const failures = results.flatMap(result =>
          result.status === 'rejected' ? cleanupFailuresOf(result.reason) : []
        )
        if (failures.length > 0) this.interruptedResolver.reject(resourceReleaseFailed(failures))
        else this.interruptedResolver.resolve()
        return failures
      }
    )
    return this.interruptedPromise
  }
}

const resourceReleaseFailed = (failures: readonly unknown[]) =>
  new AggregateError(failures, 'Resource release failed')

const cleanupFailuresOf = (failure: unknown): readonly unknown[] => {
  // TODO: Investigate focused unwrapping for interruption-time ForkError wrappers
  // around rejected Async cleanup, while preserving useful runtime traces.
  const cleanupFailure = isResourceReleaseFailure(failure)
    ? failure
    : typeof failure === 'object' && failure !== null && 'cause' in failure && isResourceReleaseFailure(failure.cause)
    ? failure.cause
    : undefined

  return cleanupFailure === undefined
    ? [failure]
    : cleanupFailure.errors.flatMap(cleanupFailuresOf)
}

const isResourceReleaseFailure = (failure: unknown): failure is AggregateError =>
  failure instanceof AggregateError && failure.message === 'Resource release failed'
