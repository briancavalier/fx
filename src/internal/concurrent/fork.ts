import { Async } from '../../Async.js'
import { at } from '../../Breadcrumb.js'
import { indexed } from '../../Breadcrumb.js'
import { Fail } from '../../Fail.js'
import { flatMap, flatten, fx, Fx, ok } from '../../Fx.js'
import { Handle } from '../../Handler.js'
import { HandlerCapture, handleCaptured, withCapturedHandlers } from '../../HandlerCapture.js'
import { Task, wait as waitTask } from '../../Task.js'
import { captureTrace, Trace } from '../../Trace.js'
import type { TraceFrameKind, TraceOrigin } from '../../Trace.js'
import { Semaphore } from '../Semaphore.js'
import { acquireAndRunFork } from '../runFork.js'
import { currentRuntimeContext } from '../runtimeContext.js'
import { Concurrently, Fork, RaceAllFailed } from './effects.js'
import type { ConcurrentPolicy, ConcurrentResult, EffectsOf, ErrorsOf, ResultOf } from './effects.js'

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

const runConcurrently = <const Policy extends ConcurrentPolicy, const Fxs extends readonly Fx<unknown, unknown>[]>(
  group: Concurrently<Policy, Fxs>
): Fx<Fork | Async | ConcurrentPolicyEffects<Policy, Fxs>, ConcurrentResult<Policy, Fxs>> =>
  forkEach(group.arg.fxs, group.arg).pipe(
    flatMap(tasks => waitTask(taskForPolicy(group.arg.policy, tasks)))
  ) as Fx<Fork | Async | ConcurrentPolicyEffects<Policy, Fxs>, ConcurrentResult<Policy, Fxs>>

const forkEach = <const Fxs extends readonly Fx<unknown, unknown>[]>(
  fxs: Fxs,
  options: TraceOrigin
) => fx(function* () {
  const parent = traceOrigin(options, 'fx/Concurrent/forkEach', forkEach)
  const ps = [] as Task<unknown, unknown>[]
  const kind = childFrameKind(parent.trace)
  for (let i = 0; i < fxs.length; i++) {
    const trace = childTraceOrigin(parent, i, kind)
    ps.push(yield* forkChild(fxs[i], trace))
  }
  return ps
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, {
  readonly [K in keyof Fxs]: Task<ResultOf<Fxs[K]>, ErrorsOf<EffectsOf<Fxs[K]>>>
}>

const forkChild = <const E, const A>(
  f: Fx<E, A>,
  trace: TraceOrigin
): Fx<Exclude<E, Async | Fail<any>> | Fork | HandlerCapture<'fx/Concurrent/Fork'>, Task<A, ErrorsOf<E>>> =>
  withCapturedHandlers('fx/Concurrent/Fork', f).pipe(
    flatMap(fx => new Fork({ fx, ...trace }) as Fx<Fork, Task<A, ErrorsOf<E>>>)
  ) as Fx<Exclude<E, Async | Fail<any>> | Fork | HandlerCapture<'fx/Concurrent/Fork'>, Task<A, ErrorsOf<E>>>

const childFrameKind = (trace: Trace | undefined) =>
  trace?.frame.kind === 'all' || trace?.frame.kind === 'race' ? trace.frame.kind : 'fork'

const traceOrigin = (
  options: TraceOrigin,
  message: string,
  caller: Function
): TraceOrigin => {
  const origin = options.origin ?? at(message, caller)
  const trace = options.trace ?? captureTrace(origin, undefined, { kind: 'fork' })
  return { origin, trace }
}

const childTraceOrigin = (parent: TraceOrigin, index: number, kind: TraceFrameKind): TraceOrigin => {
  const origin = indexed(parent.origin, index)
  return { origin, trace: captureTrace(origin, parent.trace, { kind, index }) }
}

type AnyConcurrently = Concurrently<any, any>
type ConcurrentPolicyEffects<Policy extends ConcurrentPolicy, Fxs extends readonly Fx<unknown, unknown>[]> =
  Policy['tag'] extends 'firstSuccess'
  ? FirstSuccessFailure<Fxs>
  : ErrorsOf<EffectsOf<Fxs[number]>>
type ConcurrentEffects<E> = E extends Concurrently<infer Policy, infer Fxs> ? Async | ConcurrentPolicyEffects<Policy, Fxs> : never
type WithConcurrencyHandledEffects<E> =
  Handle<Handle<Handle<E, AnyConcurrently, Fork | Async | ConcurrentEffects<E>>, Fork>, HandlerCapture<'fx/Concurrent/Fork'> | HandlerCapture<'fx/Concurrent/Concurrently'>>
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
