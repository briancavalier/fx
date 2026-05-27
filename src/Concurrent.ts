import { Async } from './Async.js'
import { at, indexed } from './Breadcrumb.js'
import { Effect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, flatMap, flatten, fx, ok } from './Fx.js'
import { Handle, handle } from './Handler.js'
import { HandlerCapture, handleCaptured, mapCapturedHandlers, withCapturedHandlers } from './HandlerCapture.js'
import { Task, wait as waitTask } from './Task.js'
import type { TraceFrameKind, TraceOptions, TraceOrigin } from './Trace.js'
import { Trace, captureTrace } from './Trace.js'
import { Semaphore } from './internal/Semaphore.js'
import { CooperativeRuntime, type CooperativeConfig } from './internal/withCoopConcurrency.js'
import { acquireAndRunFork } from './internal/runFork.js'
import { currentRuntimeContext } from './internal/runtimeContext.js'

/**
 * Request that a computation be started concurrently.
 *
 * A `Fork` request returns a {@link Task} handle. The scheduling policy is
 * supplied by handlers such as {@link withBoundedConcurrency} or {@link withUnboundedConcurrency}.
 */
export class Fork extends Effect('fx/Concurrent/Fork')<ForkContext, Task<unknown, unknown>> { }

export interface ForkContext extends TraceOrigin {
  readonly fx: Fx<unknown, unknown>
}

export const allPolicy = { tag: 'all' } as const
export const firstSettledPolicy = { tag: 'firstSettled' } as const
export const firstSuccessPolicy = { tag: 'firstSuccess' } as const
export type ConcurrentPolicy =
  | typeof allPolicy
  | typeof firstSettledPolicy
  | typeof firstSuccessPolicy

/**
 * Request that a group of computations run concurrently with a structured
 * settlement policy.
 */
export class Concurrently<
  const Policy extends ConcurrentPolicy,
  const Fxs extends readonly Fx<unknown, unknown>[]
> extends Effect('fx/Concurrent/Concurrently')<ConcurrentContext<Policy, Fxs>, ConcurrentResult<Policy, Fxs>> { }

/**
 * Context shared by structured concurrency requests.
 */
export interface ConcurrentContext<
  Policy extends ConcurrentPolicy,
  Fxs extends readonly Fx<unknown, unknown>[]
> extends TraceOrigin {
  readonly policy: Policy
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
 * @example
 * const [user, posts] = yield* all([fetchUser, fetchPosts])
 */
export const all = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: Fxs,
  options?: TraceOptions
) => concurrently(allPolicy, fxs, traceOrigin(options, 'fx/Concurrent/all', all, 'all'))

/**
 * Map an iterable to child computations and run them concurrently in input
 * order.
 *
 * @example
 * const users = yield* mapAll(userIds, id => fetchUser(id))
 */
export const mapAll = <const A, const E, const B>(
  items: Iterable<A>,
  f: (item: A, index: number) => Fx<E, B>,
  options?: TraceOptions
): Fx<Exclude<E, Async | Fail<any>> | Concurrently<typeof allPolicy, readonly Fx<E, B>[]> | HandlerCapture<'fx/Concurrent/Concurrently'>, readonly B[]> => {
  const trace = traceOrigin(options, 'fx/Concurrent/mapAll', mapAll, 'all')
  return all(Array.from(items, f), trace)
}

/**
 * Request that a tuple of Fx computations race in a structured scope.
 *
 * @example
 * const value = yield* race([primary, fallback])
 */
export const race = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: Fxs,
  options?: TraceOptions
) => concurrently(firstSettledPolicy, fxs, traceOrigin(options, 'fx/Concurrent/race', race, 'race'))

/**
 * Request that a group of computations run concurrently with the supplied
 * built-in policy.
 */
export const concurrently = <
  const Policy extends ConcurrentPolicy,
  const Fxs extends readonly Fx<unknown, unknown>[]
>(
  policy: Policy,
  fxs: Fxs,
  options?: TraceOptions
) => {
  const trace = traceOrigin(options, 'fx/Concurrent/concurrently', concurrently, policyFrameKind(policy))
  return mapCapturedHandlers('fx/Concurrent/Concurrently', fxs).pipe(
    flatMap(fxs => new Concurrently({
      policy,
      fxs: fxs as unknown as Fxs,
      ...trace
    }))
  ) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Concurrently<Policy, Fxs> | HandlerCapture<'fx/Concurrent/Concurrently'>, ConcurrentResult<Policy, Fxs>>
}

export interface CoopConcurrencyOptions {
  readonly concurrency?: number
  readonly yieldBudget?: number
}

/**
 * Provide cooperative concurrency for built-in structured concurrency policies.
 */
export const withCoopConcurrency = (options: CoopConcurrencyOptions = {}) => {
  const normalized = normalizeCoopOptions(options, 'withCoopConcurrency')
  const runtime = new CooperativeRuntime(normalized)
  return <const E, const A>(f: Fx<E, A>): Fx<CoopConcurrencyHandledEffects<E>, A> =>
    f.pipe(
      handleCaptured('fx/Concurrent/Concurrently', Concurrently, runtime.runConcurrently),
      handleCaptured('fx/Concurrent/Fork', Fork, runtime.runFork)
    ) as Fx<CoopConcurrencyHandledEffects<E>, A>
}

/**
 * Retag a structured concurrency request for first-settled race semantics.
 */
export const firstSettled = <const E, const A>(f: Fx<E, A>): Fx<Handle<E, AnyConcurrently, RetagConcurrently<typeof firstSettledPolicy, E> | HandlerCapture<'fx/Concurrent/Concurrently'>>, A> =>
  f.pipe(handle(Concurrently, retagConcurrently(firstSettledPolicy))) as Fx<Handle<E, AnyConcurrently, RetagConcurrently<typeof firstSettledPolicy, E> | HandlerCapture<'fx/Concurrent/Concurrently'>>, A>

/**
 * Retag a structured concurrency request for first-success race semantics.
 */
export const firstSuccess = <const E, const A>(f: Fx<E, A>): Fx<Handle<E, AnyConcurrently, RetagConcurrently<typeof firstSuccessPolicy, E> | HandlerCapture<'fx/Concurrent/Concurrently'>>, A> =>
  f.pipe(handle(Concurrently, retagConcurrently(firstSuccessPolicy))) as Fx<Handle<E, AnyConcurrently, RetagConcurrently<typeof firstSuccessPolicy, E> | HandlerCapture<'fx/Concurrent/Concurrently'>>, A>

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
 * Structured concurrency policies are interpreted by forking child tasks, so
 * `withBoundedConcurrency` also limits structured child concurrency.
 */
export const withBoundedConcurrency = (maxConcurrency: number) => <const E, const A>(f: Fx<E, A>): Fx<WithConcurrencyHandledEffects<E>, A> => {
  const semaphore = new Semaphore(maxConcurrency)
  return (
  withCapturedHandlers('fx/Concurrent/Fork', f).pipe(
    flatMap(fx =>
      ok(fx.pipe(
        handleCaptured('fx/Concurrent/Concurrently', Concurrently, runConcurrently),
        handleCaptured('fx/Concurrent/Fork', Fork, runForkWith(semaphore))
      ))
    ),
    flatten
  ) as Fx<WithConcurrencyHandledEffects<E>, A>
  )
}

/**
 * Handle Fork by running forked computations without a concurrency limit.
 */
export const withUnboundedConcurrency = withBoundedConcurrency(Infinity)

const runForkWith = (s: Semaphore) =>
  (fork: Fork): Fx<never, Task<unknown, unknown>> =>
    ok(acquireAndRunFork(fork.arg, s))

const childFrameKind = (trace: Trace | undefined) =>
  trace?.frame.kind === 'all' || trace?.frame.kind === 'race' ? trace.frame.kind : 'fork'

const policyFrameKind = (policy: ConcurrentPolicy): TraceFrameKind =>
  policy.tag === 'all' ? 'all' : 'race'

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

const runConcurrently = <const Policy extends ConcurrentPolicy, const Fxs extends readonly Fx<unknown, unknown>[]>(
  group: Concurrently<Policy, Fxs>
): Fx<Fork | Async | ConcurrentPolicyEffects<Policy, Fxs>, ConcurrentResult<Policy, Fxs>> =>
  forkEach(group.arg.fxs, group.arg).pipe(
    flatMap(tasks => waitTask(taskForPolicy(group.arg.policy, tasks)))
  ) as Fx<Fork | Async | ConcurrentPolicyEffects<Policy, Fxs>, ConcurrentResult<Policy, Fxs>>

const retagConcurrently = <const Policy extends ConcurrentPolicy>(policy: Policy) =>
  <const CurrentPolicy extends ConcurrentPolicy, const Fxs extends readonly Fx<unknown, unknown>[]>(
    group: Concurrently<CurrentPolicy, Fxs>
  ): Fx<Concurrently<Policy, Fxs> | HandlerCapture<'fx/Concurrent/Concurrently'>, ConcurrentResult<Policy, Fxs>> =>
    mapCapturedHandlers('fx/Concurrent/Concurrently', group.arg.fxs).pipe(
      flatMap(fxs => new Concurrently({
        ...group.arg,
        policy,
        fxs: fxs as unknown as Fxs
      }))
    ) as Fx<Concurrently<Policy, Fxs> | HandlerCapture<'fx/Concurrent/Concurrently'>, ConcurrentResult<Policy, Fxs>>

const taskForPolicy = <const Policy extends ConcurrentPolicy, Tasks extends readonly Task<unknown, unknown>[]>(
  policy: Policy,
  tasks: Tasks
): Task<ConcurrentTaskResult<Policy, Tasks>, ConcurrentTaskErrors<Policy, Tasks>> => {
  switch (policy.tag) {
    case 'all': return taskAll(tasks) as Task<ConcurrentTaskResult<Policy, Tasks>, ConcurrentTaskErrors<Policy, Tasks>>
    case 'firstSettled': return taskRace(tasks) as Task<ConcurrentTaskResult<Policy, Tasks>, ConcurrentTaskErrors<Policy, Tasks>>
    case 'firstSuccess': return taskFirstSuccess(tasks) as Task<ConcurrentTaskResult<Policy, Tasks>, ConcurrentTaskErrors<Policy, Tasks>>
  }
}

export type EffectsOf<F> = F extends Fx<infer E, unknown> ? E : never
export type ResultOf<F> = F extends Fx<unknown, infer A> ? A : never
export type ErrorsOf<E> = Extract<E, Fail<any>>

type AnyConcurrently = Concurrently<any, any>
type RetagConcurrently<Policy extends ConcurrentPolicy, E> = E extends Concurrently<any, infer Fxs> ? Concurrently<Policy, Fxs> : never
type ConcurrentPolicyEffects<Policy extends ConcurrentPolicy, Fxs extends readonly Fx<unknown, unknown>[]> =
  Policy['tag'] extends 'firstSuccess'
  ? FirstSuccessFailure<Fxs>
  : ErrorsOf<EffectsOf<Fxs[number]>>
export type ConcurrentResult<Policy extends ConcurrentPolicy, Fxs extends readonly Fx<unknown, unknown>[]> =
  Policy['tag'] extends 'all'
  ? { readonly [K in keyof Fxs]: ResultOf<Fxs[K]> }
  : ResultOf<Fxs[number]>
type ConcurrentEffects<E> = E extends Concurrently<infer Policy, infer Fxs> ? Async | ConcurrentPolicyEffects<Policy, Fxs> : never
type WithConcurrencyHandledEffects<E> =
  Handle<Handle<Handle<E, AnyConcurrently, Fork | Async | ConcurrentEffects<E>>, Fork>, HandlerCapture<'fx/Concurrent/Fork'> | HandlerCapture<'fx/Concurrent/Concurrently'>>
type CoopConcurrencyHandledEffects<E> =
  Handle<Handle<Handle<E, AnyConcurrently, ConcurrentEffects<E>>, Fork>, HandlerCapture<'fx/Concurrent/Fork'> | HandlerCapture<'fx/Concurrent/Concurrently'>>
type FirstSuccessFailure<Fxs extends readonly Fx<unknown, unknown>[]> =
  EveryFxCanFail<Fxs> extends true ? Fail<RaceAllFailed<FailuresOfFxs<Fxs>>> : never
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
type ConcurrentTaskResult<Policy extends ConcurrentPolicy, Tasks extends readonly Task<unknown, unknown>[]> =
  Policy['tag'] extends 'all'
  ? { readonly [K in keyof Tasks]: TaskResult<Tasks[K]> }
  : TaskResult<Tasks[number]>
type ConcurrentTaskErrors<Policy extends ConcurrentPolicy, Tasks extends readonly Task<unknown, unknown>[]> =
  Policy['tag'] extends 'firstSuccess'
  ? RaceAllFailed<TaskErrorsOf<Tasks>>
  : TaskErrors<Tasks[number]>

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

const normalizeCoopOptions = (options: CoopConcurrencyOptions, handlerName: string): CooperativeConfig => {
  const concurrency = options.concurrency ?? Infinity
  const yieldBudget = options.yieldBudget ?? 64
  if (concurrency <= 0 || (concurrency !== Infinity && !Number.isInteger(concurrency))) {
    throw new RangeError(`${handlerName} concurrency must be a positive integer or Infinity, got ${concurrency}`)
  }
  if (yieldBudget <= 0 || !Number.isInteger(yieldBudget)) {
    throw new RangeError(`${handlerName} yieldBudget must be a positive integer, got ${yieldBudget}`)
  }
  return {
    concurrency,
    yieldBudget
  }
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
