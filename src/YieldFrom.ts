import { Abort, abort } from './Abort.js'
import { Async, assertPromise } from './Async.js'
import { ScopedEffect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, assertSync, bracket, fx, map, ok, unit } from './Fx.js'
import { handleScoped } from './Handler.js'
import { Sink, ExcludeSink } from './Sink.js'
import type { Interrupt } from './Interrupt.js'
import * as Queue from './internal/Queue.js'
import { dispose } from './internal/disposable.js'
import { drainIteratorReturn } from './internal/iteratorClose.js'
import { IfAny } from './internal/type.js'

declare const YieldingTypeId: unique symbol

export type Yielding<Out, In = void> = {
  readonly [YieldingTypeId]: {
    readonly out: Out
    readonly in: In
  }
}

export type YieldOutput<Scope> =
  Scope extends Yielding<infer Out, unknown> ? Out : never

export type YieldInput<Scope> =
  Scope extends Yielding<unknown, infer In> ? In : never

/**
 * Yield a value to the named scope.
 */
export class YieldFrom<
  const Scope extends string & Yielding<unknown, unknown>
> extends ScopedEffect('fx/YieldFrom')<Scope, YieldOutput<Scope>, YieldInput<Scope>> { }

/**
 * Yield a value to the named scope.
 */
export const yieldFrom = <const Scope extends string & Yielding<unknown, unknown>>(
  scope: Scope,
  value: YieldOutput<Scope>
): YieldFrom<Scope> =>
  new YieldFrom(scope, value)

export type YieldValue<E, Scope extends string & Yielding<unknown, unknown>> =
  E extends YieldFrom<Scope> ? YieldOutput<Scope> : never

export type ExcludeYieldFrom<E, Scope extends string & Yielding<unknown, unknown>, E2 = never> =
  E extends YieldFrom<Scope> ? E2 : E

export const TakeScope = 'fx/YieldFrom/take' as const

export interface IterableWithReturn<Y, R> {
  [Symbol.iterator](): Iterator<Y, R>
}

export interface AsyncIterableWithReturn<Y, R> {
  [Symbol.asyncIterator](): AsyncIterator<Y, R>
}

export type PipeResult<Source, Sink> =
  | { readonly type: 'sourceEnded'; readonly value: Source }
  | { readonly type: 'sinkEnded'; readonly value: Sink }

/**
 * Collect all one-way yields from the named scope.
 */
export const collectFrom = <const Scope extends string & Yielding<unknown, void>>(scope: Scope) =>
  <const E, const A>(
    f: Fx<E, A>
  ): Fx<ExcludeYieldFrom<E, Scope>, readonly [A, readonly YieldValue<E, Scope>[]]> => {
    const values = [] as YieldValue<E, Scope>[]

    return f.pipe(
      handleScoped(YieldFrom<Scope>, scope, effect =>
        ok(void values.push(effect.arg as YieldValue<E, Scope>) as YieldInput<Scope>)),
      map(result => [result, values] as const)
    ) as Fx<ExcludeYieldFrom<E, Scope>, readonly [A, readonly YieldValue<E, Scope>[]]>
  }

/**
 * Apply an effectful function to each yield from the named scope.
 */
export const forEachFrom = <const Scope extends string & Yielding<unknown, void>, E, R, E2>(
  scope: Scope,
  f: Fx<E, R>,
  each: (a: YieldValue<E, Scope>) => Fx<E2, void>
): Fx<ExcludeYieldFrom<E, Scope, E2>, R> =>
  f.pipe(handleScoped(YieldFrom<Scope>, scope, effect =>
    each(effect.arg as YieldValue<E, Scope>) as Fx<E2, YieldInput<Scope>>
  )) as Fx<ExcludeYieldFrom<E, Scope, E2>, R>

/**
 * Transform each yield from the named scope.
 */
export const mapFrom = <const Scope extends string & Yielding<unknown, void>, E, R>(
  scope: Scope,
  f: Fx<E, R>,
  map: (a: YieldValue<E, Scope>) => YieldOutput<Scope>
): Fx<ExcludeYieldFrom<E, Scope, YieldFrom<Scope>>, R> =>
  forEachFrom(scope, f, a => yieldFrom(scope, map(a)))

/**
 * Drop yields from the named scope that don't satisfy the predicate.
 */
export const filterFrom: {
  <const Scope extends string & Yielding<unknown, void>, E, R, B extends YieldValue<E, Scope>>(
    scope: Scope,
    f: Fx<E, R>,
    refinement: (a: YieldValue<E, Scope>) => a is B
  ): Fx<ExcludeYieldFrom<E, Scope, YieldFrom<Scope>>, R>
  <const Scope extends string & Yielding<unknown, void>, E, R>(
    scope: Scope,
    f: Fx<E, R>,
    predicate: (a: YieldValue<E, Scope>) => boolean
  ): Fx<E, R>
} = <const Scope extends string & Yielding<unknown, void>, E, R>(
  scope: Scope,
  f: Fx<E, R>,
  predicate: (a: YieldValue<E, Scope>) => boolean
): Fx<ExcludeYieldFrom<E, Scope, YieldFrom<Scope>>, R> =>
    forEachFrom(scope, f, a => predicate(a) ? yieldFrom(scope, a as YieldOutput<Scope>) : unit)

/**
 * Take the first n yields from the named scope.
 */
export const takeFrom = <const Scope extends string & Yielding<unknown, void>>(scope: Scope, n: number) =>
  <const E, const R>(f: Fx<E, R>) => {
    let i = n
    return f.pipe(handleScoped(YieldFrom<Scope>, scope, effect =>
      (i-- > 0 ? yieldFrom(scope, effect.arg as YieldOutput<Scope>) : abort(TakeScope)) as Fx<YieldFrom<Scope> | Abort<typeof TakeScope>, YieldInput<Scope>>
    )) as Fx<ExcludeYieldFrom<E, Scope, YieldFrom<Scope> | Abort<typeof TakeScope>>, R>
  }

/**
 * Create a scoped yield source from a {@link Queue.Dequeue}.
 */
export const fromDequeue = <const Scope extends string & Yielding<unknown, void>>(
  scope: Scope,
  queue: Queue.Dequeue<YieldOutput<Scope>>
): Fx<Async | YieldFrom<Scope>, void> => fx(function* () {
  const take = Queue.dequeue(queue)

  while (!queue.disposed) {
    const next = yield* take
    if (next.tag === 'fx/Queue/Dequeued') yield* yieldFrom(scope, next.value)
  }
})

/**
 * Create a scoped yield source from values enqueued by f.
 */
export const withEnqueue = <const Scope extends string & Yielding<unknown, void>>(
  scope: Scope,
  f: (o: Queue.Enqueue<YieldOutput<Scope>>) => Disposable,
  queue: Queue.Queue<YieldOutput<Scope>> = new Queue.UnboundedQueue()
) => bracket(
  assertSync(() => f(queue)),
  disposable => ok(dispose(disposable)),
  _ => fromDequeue(scope, queue)
)

/**
 * Create a scoped yield source from an Iterable.
 */
export const fromIterable = <const Scope extends string & Yielding<unknown, void>, R>(
  scope: Scope,
  i: IterableWithReturn<YieldOutput<Scope>, R>
): Fx<YieldFrom<Scope> | Interrupt, IfAny<R, void>> => bracket(
  assertSync(() => i[Symbol.iterator]()),
  iterator => ok(void iterator.return?.()),
  iterator => fx(function* () {
    let result = iterator.next()
    while (!result.done) {
      yield* yieldFrom(scope, result.value)
      result = iterator.next()
    }
    return result.value
  })
) as Fx<YieldFrom<Scope> | Interrupt, IfAny<R, void>>

/**
 * Create a scoped yield source from an AsyncIterable.
 */
export const fromAsyncIterable = <const Scope extends string & Yielding<unknown, void>, R>(
  scope: Scope,
  f: () => AsyncIterableWithReturn<YieldOutput<Scope>, R>
): Fx<Async | YieldFrom<Scope> | Interrupt, R> => bracket(
  assertSync(() => f()[Symbol.asyncIterator]()),
  iterator => assertPromise(() => iterator.return?.().then(() => { }) ?? Promise.resolve()),
  iterator => fx(function* () {
    const next = assertPromise(() => iterator.next())
    let result = yield* next
    while (!result.done) {
      yield* yieldFrom(scope, result.value)
      result = yield* next
    }
    return result.value
  })
)

export const toAsyncIterable = <const Scope extends string & Yielding<unknown, void>, E extends Async | YieldFrom<Scope> | Fail<any>, A>(
  scope: Scope,
  f: Fx<E, A>
): AsyncIterableWithReturn<YieldValue<E, Scope>, A> => ({
    async *[Symbol.asyncIterator]() {
      const controller = new AbortController()
      const iterator = f[Symbol.iterator]()
      let result = iterator.next()

      try {
        while (!result.done) {
          const next = result.value
          if (next._fxEffectId === 'fx/Async') {
            const value = await next.arg.run(controller.signal)
            result = iterator.next(value)
          } else if (next._fxEffectId === 'fx/Fail') {
            throw next.arg
          } else if (YieldFrom.is(next) && next.scope === scope) {
            yield next.arg as YieldValue<E, Scope>
            result = iterator.next()
          } else {
            throw new Error(`Unexpected effect while converting YieldFrom scope ${scope} to AsyncIterable`)
          }
        }
        return result.value
      } finally {
        controller.abort()
        iterator.return?.()
      }
    }
  })

/**
 * Pipe all one-way yields from a scope into a sink for the same scope.
 */
export const to = <const Scope extends string & Yielding<unknown, void>, E1, E2, R1, R2>(
  scope: Scope,
  source: Fx<E1, R1>,
  sink: Fx<E2, R2>
): Fx<ExcludeYieldFrom<E1, Scope> | ExcludeSink<E2, Scope>, PipeResult<R1, R2>> => fx(function* () {
  const sourceIterator = source[Symbol.iterator]()
  const sinkIterator = sink[Symbol.iterator]()
  let sourceOpen = true
  let sinkOpen = true

  const drainSource = function* (
    result: IteratorResult<E1, R1>
  ): Generator<ExcludeYieldFrom<E1, Scope> | ExcludeSink<E2, Scope>, R1, unknown> {
    while (!result.done) {
      result = sourceIterator.next(yield result.value as ExcludeYieldFrom<E1, Scope>)
    }
    return result.value
  }

  const drainSink = function* (
    result: IteratorResult<E2, R2>
  ): Generator<ExcludeYieldFrom<E1, Scope> | ExcludeSink<E2, Scope>, R2, unknown> {
    while (!result.done) {
      result = sinkIterator.next(yield result.value as ExcludeSink<E2, Scope>)
    }
    return result.value
  }

  const closeSource = function* () {
    if (!sourceOpen) return
    sourceOpen = false
    yield* drainIteratorReturn(sourceIterator, drainSource as (result: IteratorResult<E1, R1>) => Generator<E1, R1, unknown>)
  }

  const closeSink = function* () {
    if (!sinkOpen) return
    sinkOpen = false
    yield* drainIteratorReturn(sinkIterator, drainSink as (result: IteratorResult<E2, R2>) => Generator<E2, R2, unknown>)
  }

  try {
    let sourceResult = sourceIterator.next()
    let sinkResult = sinkIterator.next()

    while (true) {
      while (!sourceResult.done && !(YieldFrom.is(sourceResult.value) && sourceResult.value.scope === scope)) {
        sourceResult = sourceIterator.next(yield sourceResult.value as ExcludeYieldFrom<E1, Scope>)
      }

      while (!sinkResult.done && !(Sink.is(sinkResult.value) && sinkResult.value.scope === scope)) {
        sinkResult = sinkIterator.next(yield sinkResult.value as ExcludeSink<E2, Scope>)
      }

      if (sinkResult.done) {
        sinkOpen = false
        yield* closeSource()
        return { type: 'sinkEnded', value: sinkResult.value }
      }

      if (sourceResult.done) {
        sourceOpen = false
        yield* closeSink()
        return { type: 'sourceEnded', value: sourceResult.value }
      }

      sinkResult = sinkIterator.next((sourceResult.value as YieldFrom<Scope>).arg)
      sourceResult = sourceIterator.next()
    }
  } finally {
    yield* closeSource()
    yield* closeSink()
  }
}) as Fx<ExcludeYieldFrom<E1, Scope> | ExcludeSink<E2, Scope>, PipeResult<R1, R2>>
