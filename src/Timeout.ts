import { Async, assertPromise } from './Async.js'
import { at } from './Breadcrumb.js'
import { Fork, forkIn } from './Concurrent.js'
import { Fail, catchAll, fail } from './Fail.js'
import { Finally, andFinallyExit } from './Finalization.js'
import { Fx, flatMap, fx, map, ok } from './Fx.js'
import { withCapturedHandlers, type HandlerCapture } from './HandlerCapture.js'
import { InterruptFrom, interruptFrom } from './InterruptFrom.js'
import { returnFrom } from './ReturnFrom.js'
import { scope, scopeLabel, withScope, type AnyScope, type Exit } from './Scope.js'
import { Sleep, sleep } from './Time.js'
import type { TraceOrigin } from './Trace.js'
import { attachTrace, captureTrace } from './Trace.js'
import { ScopedFork } from './internal/scopedFork.js'

/**
 * Run an Fx with a time limit, interrupting a private timeout scope when the
 * timeout wins.
 *
 * The interrupted scope runs its finalizers with a {@link TimeoutInterrupt}
 * reason, then re-yields the matching {@link InterruptFrom} so callers choose
 * how to recover or report the timeout.
 */
export function timeout<const Options extends AnyTimeoutOptions>(
  options: Options
): <const E, const A>(f: Fx<E, A>) => Fx<E | Fork | Sleep | Async | Fail<unknown> | InterruptFrom<AnyScope, TimeoutReasonOf<Options>>, A> {
  const { ms, label } = options
  const timeoutScope = scope(Symbol('fx/Timeout'), {
    label: label ?? 'timeout',
    diagnostic: false
  })
  const origin = at(`Timeout interrupted ${scopeLabel(timeoutScope)} after ${ms}ms`, timeout)
  const trace = captureTrace(origin, undefined, { kind: 'timeout' })

  return <const E, const A>(f: Fx<E, A>): Fx<E | Fork | Sleep | Async | Fail<unknown> | InterruptFrom<AnyScope, TimeoutReasonOf<Options>>, A> =>
    fx(function* () {
      yield* timeoutInWithTrace(timeoutScope, options, { origin, trace })

      yield* forkIn(timeoutScope, attempt(f as Fx<Fail<ErrorsOf<E>>, A>).pipe(
        flatMap(result => returnFrom(timeoutScope, result))
      ), { origin, trace })
    }).pipe(
      withScope(timeoutScope),
      flatMap(unwrapAttempt)
    ) as Fx<E | Fork | Sleep | Async | Fail<unknown> | InterruptFrom<AnyScope, TimeoutReasonOf<Options>>, A>
}

/**
 * Schedule a delayed interruption for a caller-owned scope.
 *
 * `timeoutIn` does not install a scope boundary. The caller must handle the
 * same scope with {@link withScope}; when the scope exits before the delay, the
 * scope finalizes the timer fork.
 */
export function timeoutIn<const Scope extends AnyScope, const Options extends AnyTimeoutOptions>(
  scope: Scope,
  options: Options
): Fx<Sleep | InterruptFrom<Scope, TimeoutReasonOf<Options>> | Fork | Finally<Scope, Async> | ScopedFork<Scope> | HandlerCapture<'fx/Concurrent/ForkIn'>, void> {
  const origin = at(`Timeout interrupted ${options.label ?? scopeLabel(scope)} after ${options.ms}ms`, timeoutIn)
  const trace = captureTrace(origin, undefined, { kind: 'timeout' })

  return timeoutInWithTrace(scope, options, { origin, trace })
}

function timeoutInWithTrace<const Scope extends AnyScope, const Options extends AnyTimeoutOptions>(
  scope: Scope,
  options: Options,
  traceOrigin: TraceOrigin
): Fx<Sleep | InterruptFrom<Scope, TimeoutReasonOf<Options>> | Fork | Finally<Scope, Async> | ScopedFork<Scope> | HandlerCapture<'fx/Concurrent/ForkIn'>, void> {
  const trace = traceOrigin.trace
  const reasonOrigin = traceOrigin.origin
  return fx(function* () {
    const task = yield* withCapturedHandlers('fx/Concurrent/ForkIn', sleep(options.ms).pipe(
      flatMap(() => interruptFrom(scope, makeTimeoutReason(options, { ms: options.ms, origin: reasonOrigin, trace })))
    )).pipe(
      flatMap(fx => new ScopedFork(scope, { fx, ...traceOrigin, keepAlive: false }))
    )
    yield* andFinallyExit(scope, exit => assertPromise(() => task.interrupt(exitReason(exit))))
  })
}

export class TimeoutInterrupt extends Error {
  readonly name = 'TimeoutInterrupt'
  declare readonly code: 'FX_TIMEOUT_INTERRUPT'

  constructor(readonly ms: number, options?: ErrorOptions) {
    super(`Interrupted after ${ms}ms`, options)
    Object.defineProperty(this, 'code', {
      value: 'FX_TIMEOUT_INTERRUPT',
      enumerable: false,
      writable: false,
      configurable: true
    })
  }
}

export interface DefaultTimeoutInterruptOptions {
  readonly ms: number
  readonly label?: string
  readonly reason?: undefined
}

export interface TimeoutInterruptOptions<Reason> {
  readonly ms: number
  readonly label?: string
  readonly reason: (e: TimeoutExpired) => Reason
}

export type AnyTimeoutOptions = DefaultTimeoutInterruptOptions | TimeoutInterruptOptions<unknown>

export type TimeoutReasonOf<Options extends AnyTimeoutOptions> =
  Options extends TimeoutInterruptOptions<infer Reason> ? Reason : TimeoutInterrupt

export interface TimeoutExpired extends TraceOrigin {
  readonly ms: number
}

export type ErrorsOf<E> = UnwrapFail<Extract<E, Fail<any>>>

const attempt = <const E, const A>(f: Fx<Fail<E>, A>): Fx<never, AttemptResult<E, A>> =>
  f.pipe(
    map(value => ({ type: 'success', value }) as const),
    catchAll(failure => ok({ type: 'failure', failure }) as Fx<never, Failure<E>>)
  ) as Fx<never, AttemptResult<E, A>>

type UnwrapFail<F> = F extends Fail<infer E> ? E : never

const makeTimeoutInterrupt = ({ ms, origin, trace }: TimeoutExpired) => {
  const error = new TimeoutInterrupt(ms, { cause: origin })
  if (trace !== undefined) attachTrace(error, trace)
  return error
}

const makeTimeoutReason = <const Options extends AnyTimeoutOptions>(
  options: Options,
  expired: TimeoutExpired
): TimeoutReasonOf<Options> =>
  options.reason === undefined
    ? makeTimeoutInterrupt(expired) as TimeoutReasonOf<Options>
    : options.reason(expired) as TimeoutReasonOf<Options>

const exitReason = (exit: Exit) =>
  exit.type === 'interrupted' ? exit.reason : undefined

type AttemptResult<E, A> = Success<A> | Failure<E>

const unwrapAttempt = <E, A>(result: AttemptResult<E, A> | void): Fx<Fail<E>, A> => {
  if (result === undefined) throw new Error('Timeout scope completed without a winner')
  return result.type === 'success'
    ? ok(result.value)
    : fail(result.failure)
}

interface Success<A> {
  readonly type: 'success'
  readonly value: A
}

interface Failure<E> {
  readonly type: 'failure'
  readonly failure: E
}
