import { Async } from './Async.js'
import { at, indexed } from './Breadcrumb.js'
import { Fail } from './Fail.js'
import { Fx, flatMap, fx } from './Fx.js'
import { Handle, handle } from './Handler.js'
import { HandlerCapture, mapCapturedHandlers, withCapturedHandlers } from './HandlerCapture.js'
import { Task } from './Task.js'
import type { TraceFrameKind, TraceOptions, TraceOrigin } from './Trace.js'
import { Trace, captureTrace } from './Trace.js'
import { withCoopConcurrency } from './internal/concurrent/cooperative.js'
import { allPolicy, Concurrently, firstSettledPolicy, firstSuccessPolicy, Fork } from './internal/concurrent/effects.js'
import type { ConcurrentPolicy, ConcurrentResult, EffectsOf, ErrorsOf, ResultOf } from './internal/concurrent/effects.js'
import { RaceAllFailed } from './internal/concurrent/effects.js'
import { withBoundedConcurrency, withUnboundedConcurrency } from './internal/concurrent/fork.js'

export {
  allPolicy,
  Concurrently,
  firstSettledPolicy,
  firstSuccessPolicy,
  Fork,
  RaceAllFailed,
  withBoundedConcurrency,
  withCoopConcurrency,
  withUnboundedConcurrency
}
export type {
  ConcurrentContext,
  ConcurrentPolicy,
  ConcurrentResult,
  EffectsOf,
  ErrorsOf,
  ForkContext,
  ResultOf
} from './internal/concurrent/effects.js'
export type { CoopConcurrencyOptions } from './internal/concurrent/cooperative.js'

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

type AnyConcurrently = Concurrently<any, any>
type RetagConcurrently<Policy extends ConcurrentPolicy, E> = E extends Concurrently<any, infer Fxs> ? Concurrently<Policy, Fxs> : never
