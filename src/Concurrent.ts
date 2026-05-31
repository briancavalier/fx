import { Async } from './Async.js'
import { at, indexed } from './Breadcrumb.js'
import { Fail, fail } from './Fail.js'
import { Fx, flatMap, fx } from './Fx.js'
import { HandlerCapture, withCapturedHandlers } from './HandlerCapture.js'
import { returnFrom } from './ReturnFrom.js'
import { scope, withScope, type Control } from './Scope.js'
import { Task } from './Task.js'
import type { TraceFrameKind, TraceOptions, TraceOrigin } from './Trace.js'
import { Trace, captureTrace } from './Trace.js'
import { withCoopConcurrency } from './internal/concurrent/cooperative.js'
import { Fork, RaceAllFailed } from './internal/concurrent/effects.js'
import type { EffectsOf, ErrorsOf, ForkScheduling, ResultOf } from './internal/concurrent/effects.js'
import { withBoundedConcurrency, withUnboundedConcurrency } from './internal/concurrent/fork.js'
import { cooperativeAssertPromise } from './internal/concurrent/cooperativeAsync.js'
import { InterruptedReturn, isInterpretingReturn } from './internal/iteratorClose.js'
import { Pipeable, pipeThis } from './internal/pipe.js'
import { settledTaskQueue, type SettledQueue, type SettledTask } from './internal/settledQueue.js'
import { ScopedFork } from './internal/scopedFork.js'
import type { ScopedForkContext } from './internal/scopedFork.js'
import type { AnyLifetimeScope } from './Scope.js'

export {
  Fork,
  RaceAllFailed,
  withBoundedConcurrency,
  withCoopConcurrency,
  withUnboundedConcurrency
}
export type {
  EffectsOf,
  ErrorsOf,
  ForkContext,
  ForkScheduling,
  ResultOf
} from './internal/concurrent/effects.js'
export type { CoopConcurrencyOptions } from './internal/concurrent/cooperative.js'

export type ForkOptions = TraceOptions & {
  /**
   * Advanced scheduling mode. Defaults to `metered`.
   *
   * Use `unmetered` only for control-plane work that must not consume bounded
   * or cooperative concurrency admission.
   */
  readonly scheduling?: ForkScheduling
}

/**
 * Start an Fx concurrently and return a {@link Task} handle.
 *
 * Use `fork` when the caller needs explicit control over a child computation's
 * lifetime. Use {@link all} or {@link race} when the caller only needs the
 * structured result.
 *
 * Advanced: `scheduling: 'unmetered'` skips only concurrency admission for
 * control-plane work. It does not change task lifetime, cleanup, failures,
 * traces, or handler capture.
 *
 * @example
 * const task = yield* fork(fetchUser)
 * const user = yield* wait(task)
 */
export const fork = <const E, const A>(
  f: Fx<E, A>,
  options?: ForkOptions
): Fx<Exclude<E, Async | Fail<any>> | Fork | HandlerCapture<'fx/Concurrent/Fork'>, Task<A, ErrorsOf<E>>> => {
  const trace = traceOrigin(options, 'fx/Concurrent/fork', fork, 'fork')
  return withCapturedHandlers('fx/Concurrent/Fork', f).pipe(
    flatMap(fx => new Fork({ fx, ...trace, scheduling: options?.scheduling }) as Fx<Fork, Task<A, ErrorsOf<E>>>)
  )
}

/**
 * Start an Fx concurrently with lifetime owned by the supplied named scope.
 *
 * `forkIn` separates lifetime from scheduling: the matching scope owns the
 * returned task's lifetime, while the nearest fork concurrency handler decides
 * when the task is allowed to start. Apply the matching {@link withScope}
 * inside an outer fork scheduler, for example
 * `program.pipe(withScope(scope), withUnboundedConcurrency)`.
 *
 * Advanced: `scheduling: 'unmetered'` is passed through to the fork scheduler
 * without changing scope ownership.
 *
 * The types follow normal effect elimination: `forkIn` introduces a
 * `ScopedFork<Scope>`, `withScope(scope)` handles it and may introduce `Fork`,
 * and a fork scheduler handles `Fork` before execution.
 */
export const forkIn = <const Scope extends AnyLifetimeScope, const E, const A>(
  scope: Scope,
  f: Fx<E, A>,
  options?: ForkOptions
): Fx<Exclude<E, Async | Fail<any>> | ScopedFork<Scope> | HandlerCapture<'fx/Concurrent/ForkIn'>, Task<A, ErrorsOf<E>>> => {
  const trace = traceOrigin(options, 'fx/Concurrent/forkIn', forkIn, 'fork')
  return withCapturedHandlers('fx/Concurrent/ForkIn', f).pipe(
    flatMap(fx => new ScopedFork(scope, { fx, ...trace, scheduling: options?.scheduling }) as Fx<ScopedFork<Scope>, Task<A, ErrorsOf<E>>>)
  )
}

/**
 * Start a tuple of Fx computations concurrently and return their {@link Task}
 * handles.
 *
 * `forkEach` is the explicit handle-based form of concurrency. The caller owns
 * each returned task and decides when to wait for or interrupt it.
 */
export const forkEach = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: readonly [...Fxs],
  options?: TraceOptions
) => fx(function* () {
  const parent = traceOrigin(options, 'fx/Concurrent/forkEach', forkEach, 'fork')
  const ps = [] as Task<unknown, unknown>[]
  const kind = childFrameKind(parent.trace)
  for (let i = 0; i < fxs.length; i++) {
    ps.push(yield* fork(fxs[i], childTraceOrigin(parent, i, kind)))
  }
  return ps
// TypeScript cannot derive the mapped task tuple from indexed pushes.
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, {
  readonly [K in keyof Fxs]: Task<ResultOf<Fxs[K]>, ErrorsOf<EffectsOf<Fxs[K]>>>
}>

/**
 * Run a tuple of Fx computations concurrently in input order.
 */
export const all = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: readonly [...Fxs],
  options?: TraceOptions
) => {
  const concurrentScope = scope(Symbol('fx/Concurrent/all'), { diagnostic: false })
  const trace = traceOrigin(options, 'fx/Concurrent/all', all, 'all')
  return fx(function* () {
    const tasks = yield* forkEachScoped(concurrentScope, fxs, trace)
    const results = yield* waitAllTasks(tasks)
    return results as { readonly [K in keyof Fxs]: ResultOf<Fxs[K]> }
  // The internal scope is private, so its ReturnFrom branch is not observable
  // through the public all result type.
  }).pipe(withScope(concurrentScope)) as Fx<StructuredEffects<Fxs>, { readonly [K in keyof Fxs]: ResultOf<Fxs[K]> }>
}

/**
 * Map an iterable to child computations and run them concurrently in input
 * order.
 */
export const mapAll = <const A, const E, const B>(
  items: Iterable<A>,
  f: (item: A, index: number) => Fx<E, B>,
  options?: TraceOptions
): Fx<Exclude<E, Async> | Fork | Async | ErrorsOf<E>, readonly B[]> =>
  all(Array.from(items, f), traceOrigin(options, 'fx/Concurrent/mapAll', mapAll, 'all'))

/**
 * Race a tuple of computations and return the first settled result.
 */
export const race = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: readonly [...Fxs],
  options?: TraceOptions
) => {
  const concurrentScope = scope<Control>()(Symbol('fx/Concurrent/race'), { diagnostic: false })
  const trace = traceOrigin(options, 'fx/Concurrent/race', race, 'race')
  return new RuntimeCloseBoundary(fx(function* () {
    if (fxs.length === 0) return yield* never()
    const tasks = yield* forkEachScoped(concurrentScope, fxs, trace)
    const result = yield* waitFirstSettled(tasks)
    if (result.type === 'failure') return yield* fail(result.failure)
    if (result.value === undefined && tasks.some(task => task._interrupted)) throw new InterruptedReturn()
    return yield* returnFrom(concurrentScope, result.value)
  // The internal scope is private, so its ReturnFrom branch is exactly the race
  // result value.
  }).pipe(withScope(concurrentScope))) as Fx<StructuredEffects<Fxs>, ResultOf<Fxs[number]>>
}

/**
 * Race a tuple of computations and return the first successful result.
 */
export const firstSuccess = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: readonly [...Fxs],
  options?: TraceOptions
) => {
  const concurrentScope = scope<Control>()(Symbol('fx/Concurrent/firstSuccess'), { diagnostic: false })
  const trace = traceOrigin(options, 'fx/Concurrent/firstSuccess', firstSuccess, 'race')
  return new RuntimeCloseBoundary(fx(function* () {
    if (fxs.length === 0) return yield* fail(new RaceAllFailed([]))
    const tasks = yield* forkEachScoped(concurrentScope, fxs, trace, 'task')
    const result = yield* waitFirstSuccess(tasks)
    if (result.type === 'failure') return yield* fail(new RaceAllFailed(result.failures))
    if (result.value === undefined && tasks.some(task => task._interrupted)) throw new InterruptedReturn()
    return yield* returnFrom(concurrentScope, result.value)
  // The internal scope is private, so its ReturnFrom branch is exactly the
  // first successful result value.
  }).pipe(withScope(concurrentScope))) as Fx<FirstSuccessEffects<Fxs>, ResultOf<Fxs[number]>>
}

const forkEachScoped = <const Scope extends AnyLifetimeScope, const Fxs extends readonly Fx<unknown, unknown>[]>(
  concurrentScope: Scope,
  fxs: readonly [...Fxs],
  options: TraceOrigin,
  failure: ScopedForkContext['failure'] = 'join'
) => fx(function* () {
  const parent = traceOrigin(options, 'fx/Concurrent/forkEach', forkEachScoped, 'fork')
  const ps = [] as Task<unknown, unknown>[]
  const kind = childFrameKind(parent.trace)
  for (let i = 0; i < fxs.length; i++) {
    ps.push(yield* forkInScoped(concurrentScope, fxs[i], childTraceOrigin(parent, i, kind), failure))
  }
  return ps
// TypeScript cannot derive the mapped task tuple from indexed pushes.
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async> | ScopedFork<Scope> | HandlerCapture<'fx/Concurrent/ForkIn'>, {
  readonly [K in keyof Fxs]: Task<ResultOf<Fxs[K]>, ErrorsOf<EffectsOf<Fxs[K]>>>
}>

const forkInScoped = <const Scope extends AnyLifetimeScope, const E, const A>(
  scope: Scope,
  f: Fx<E, A>,
  trace: TraceOrigin,
  failure: ScopedForkContext['failure']
): Fx<Exclude<E, Async | Fail<any>> | ScopedFork<Scope> | HandlerCapture<'fx/Concurrent/ForkIn'>, Task<A, ErrorsOf<E>>> =>
    withCapturedHandlers('fx/Concurrent/ForkIn', f).pipe(
      flatMap(fx => new ScopedFork(scope, { fx, ...trace, failure }) as Fx<ScopedFork<Scope>, Task<A, ErrorsOf<E>>>)
    )

const childFrameKind = (trace: Trace | undefined) =>
  trace?.frame.kind === 'all' || trace?.frame.kind === 'race' ? trace.frame.kind : 'fork'

const traceOrigin = (
  options: TraceOptions | TraceOrigin | undefined,
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

type StructuredEffects<Fxs extends readonly Fx<unknown, unknown>[]> =
  Exclude<EffectsOf<Fxs[number]>, Async> | Fork | Async | ErrorsOf<EffectsOf<Fxs[number]>>
type FirstSuccessEffects<Fxs extends readonly Fx<unknown, unknown>[]> =
  Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork | Async | FirstSuccessFailure<Fxs>
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

const never = <A>(): Fx<Async, A> =>
  new Async({ run: () => new Promise<A>(() => { }), origin: at('fx/Concurrent/never', never) }) as Fx<Async, A>

const waitAllTasks = <const Tasks extends readonly Task<unknown, unknown>[]>(
  tasks: Tasks
): Fx<Async | TaskErrors<Tasks[number]>, { readonly [K in keyof Tasks]: TaskResult<Tasks[K]> }> => fx(function* () {
  const results = [] as TaskResult<Tasks[number]>[]
  const pending = new Set<Task<unknown, unknown>>(tasks)
  const indexes = taskIndexes(tasks)
  const settled = settledTaskQueue(tasks)

  while (pending.size > 0) {
    const result = yield* waitSettled(settled)

    pending.delete(result.task)
    if (result.task._interrupted) continue
    const index = indexes.get(result.task) ?? -1
    if (result.type === 'failure') return yield* fail(result.failure)
    results[index] = result.value as TaskResult<Tasks[number]>
  }

  return results.length === tasks.length
    ? results as { readonly [K in keyof Tasks]: TaskResult<Tasks[K]> }
    : yield* never()
// TypeScript cannot connect rejected task promises back to the task error row
// after Promise.race over an indexed array.
}) as Fx<Async | TaskErrors<Tasks[number]>, { readonly [K in keyof Tasks]: TaskResult<Tasks[K]> }>

const waitFirstSettled = <const Tasks extends readonly Task<unknown, unknown>[]>(
  tasks: Tasks
): Fx<Async | Fail<unknown>, FirstSettledResult<TaskResult<Tasks[number]>>> =>
  cooperativeAssertPromise(async () => {
    const pending = new Set<Task<unknown, unknown>>(tasks)
    const settled = settledTaskQueue(tasks)

    while (pending.size > 0) {
      const result = await settled.next()

      pending.delete(result.task)
      if (result.task._interrupted) continue
      if (result.type === 'success') return { type: 'success', value: result.value as TaskResult<Tasks[number]> }
      return { type: 'failure', failure: result.failure }
    }

    return await pendingPromise()
  }, at('fx/Concurrent/waitFirstSettled', waitFirstSettled))

const waitFirstSuccess = <const Tasks extends readonly Task<unknown, unknown>[]>(
  tasks: Tasks
): Fx<Async | Fail<unknown>, FirstSuccessResult<TaskResult<Tasks[number]>, TaskErrorsOf<Tasks>>> =>
  cooperativeAssertPromise(async () => {
    const pending = new Set<Task<unknown, unknown>>(tasks)
    const indexes = taskIndexes(tasks)
    const settled = settledTaskQueue(tasks)
    const failures = [] as unknown[]

    while (pending.size > 0) {
      const result = await settled.next()

      pending.delete(result.task)
      if (result.task._interrupted) continue
      if (result.type === 'success') return { type: 'success', value: result.value as TaskResult<Tasks[number]> }
      failures[indexes.get(result.task) ?? -1] = result.failure
    }

    return failures.length === 0
      ? await pendingPromise()
      : { type: 'failure', failures: failures as TaskErrorsOf<Tasks> }
  }, at('fx/Concurrent/waitFirstSuccess', waitFirstSuccess))

type FirstSettledResult<A> =
  | { readonly type: 'success', readonly value: A }
  | { readonly type: 'failure', readonly failure: unknown }

type FirstSuccessResult<A, E extends readonly unknown[]> =
  | { readonly type: 'success', readonly value: A }
  | { readonly type: 'failure', readonly failures: E }

const pendingPromise = <A>(): Promise<A> => new Promise(() => { })

const waitSettled = <A>(
  settled: SettledQueue<SettledTask<Task<unknown, unknown>>>
): Fx<Async, TaskSettlement<A>> =>
  cooperativeAssertPromise(() => settled.next() as Promise<TaskSettlement<A>>, at('fx/Concurrent/waitSettled', waitSettled))

type TaskSettlement<A> =
  | { readonly task: Task<unknown, unknown>, readonly type: 'success', readonly value: A }
  | { readonly task: Task<unknown, unknown>, readonly type: 'failure', readonly failure: unknown }

const taskIndexes = (tasks: readonly Task<unknown, unknown>[]): Map<Task<unknown, unknown>, number> => {
  const indexes = new Map<Task<unknown, unknown>, number>()
  for (let i = 0; i < tasks.length; i++) indexes.set(tasks[i], i)
  return indexes
}

class RuntimeCloseBoundary<E, A> implements Fx<E, A>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(readonly fx: Fx<E, A>) { }

  [Symbol.iterator](): Iterator<E, A, unknown> {
    const iterator = this.fx[Symbol.iterator]()
    let closing = false

    return {
      next(value?: unknown) {
        const result = iterator.next(value)
        if (closing && result.done) throw new InterruptedReturn()
        return result
      },
      return(value?: unknown) {
        closing = isInterpretingReturn()
        const result = iterator.return?.(value as A) ?? { done: true, value: undefined as A }
        if (closing && result.done) throw new InterruptedReturn()
        return result
      },
      throw(error?: unknown) {
        return iterator.throw?.(error) ?? (() => { throw error })()
      }
    }
  }
}
