import { Effect } from '../../Effect.js'
import { Fail } from '../../Fail.js'
import { Fx } from '../../Fx.js'
import { Task } from '../../Task.js'
import type { TraceOrigin } from '../../Trace.js'

/**
 * Request that a computation be started concurrently.
 *
 * A `Fork` request returns a {@link Task} handle. The scheduling policy is
 * supplied by handlers such as `withBoundedConcurrency` or `withUnboundedConcurrency`.
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
 * Failure returned by `firstSuccess` when every raced child fails.
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

export type EffectsOf<F> = F extends Fx<infer E, unknown> ? E : never
export type ResultOf<F> = F extends Fx<unknown, infer A> ? A : never
export type ErrorsOf<E> = Extract<E, Fail<any>>

export type ConcurrentResult<Policy extends ConcurrentPolicy, Fxs extends readonly Fx<unknown, unknown>[]> =
  Policy['tag'] extends 'all'
  ? { readonly [K in keyof Fxs]: ResultOf<Fxs[K]> }
  : ResultOf<Fxs[number]>
