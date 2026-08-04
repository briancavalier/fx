import { Async, assertPromise } from './Async.js'
import { KeyedEffect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, assertSync, bracket, fx, map, ok } from './Fx.js'
import { handleKeyed } from './Handler.js'
import type { AnyKey } from './Key.js'
import { Sink, ExcludeSink, type Receiving, type SinkInput } from './Sink.js'
import { keyLabel } from './Key.js'
import type { Interrupt } from './Interrupt.js'
import * as Queue from './internal/Queue.js'
import { dispose } from './internal/disposable.js'
import { sameKey } from './internal/keyIdentity.js'
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
  const Key extends AnyKey & Yielding<unknown, unknown>
> extends KeyedEffect('fx/YieldFrom')<Key, YieldOutput<Key>, YieldInput<Key>> { }

/**
 * Yield a value to the named scope.
 */
export const yieldFrom = <const Key extends AnyKey & Yielding<unknown, unknown>>(
  key: Key,
  value: YieldOutput<Key>
): YieldFrom<Key> =>
  new YieldFrom(key, value)

export type YieldValue<E, Key extends AnyKey & Yielding<unknown, unknown>> =
  E extends YieldFrom<Key> ? YieldOutput<Key> : never

export type ExcludeYieldFrom<E, Key extends AnyKey & Yielding<unknown, unknown>, E2 = never> =
  E extends YieldFrom<Key> ? E2 : E

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
export const collectFrom = <const Key extends AnyKey & Yielding<unknown, void>>(key: Key) =>
  <const E, const A>(
    f: Fx<E, A>
  ): Fx<ExcludeYieldFrom<E, Key>, readonly [A, readonly YieldValue<E, Key>[]]> => {
    const values = [] as YieldValue<E, Key>[]

    return f.pipe(
      handleKeyed(YieldFrom<Key>, key, effect =>
        ok(void values.push(effect.arg as YieldValue<E, Key>) as YieldInput<Key>)),
      map(result => [result, values] as const)
    ) as Fx<ExcludeYieldFrom<E, Key>, readonly [A, readonly YieldValue<E, Key>[]]>
  }

/**
 * Apply an effectful function to each yield from the named scope.
 */
export const forEachFrom = <const Key extends AnyKey & Yielding<unknown, void>, E, R, E2>(
  key: Key,
  f: Fx<E, R>,
  each: (a: YieldValue<E, Key>) => Fx<E2, void>
): Fx<ExcludeYieldFrom<E, Key, E2>, R> =>
  f.pipe(handleKeyed(YieldFrom<Key>, key, effect =>
    each(effect.arg as YieldValue<E, Key>) as Fx<E2, YieldInput<Key>>
  )) as Fx<ExcludeYieldFrom<E, Key, E2>, R>

/**
 * Create a scoped yield source from a {@link Queue.Dequeue}.
 */
export const fromDequeue = <const Key extends AnyKey & Yielding<unknown, void>>(
  key: Key,
  queue: Queue.Dequeue<YieldOutput<Key>>
): Fx<Async | YieldFrom<Key>, void> => fx(function* () {
  const take = Queue.dequeue(queue)

  while (!queue.disposed) {
    const next = yield* take
    if (next.tag === 'fx/Queue/Dequeued') yield* yieldFrom(key, next.value)
  }
})

/**
 * Create a scoped yield source from values enqueued by f.
 */
export const withEnqueue = <const Key extends AnyKey & Yielding<unknown, void>>(
  key: Key,
  f: (o: Queue.Enqueue<YieldOutput<Key>>) => Disposable,
  queue: Queue.Queue<YieldOutput<Key>> = new Queue.UnboundedQueue()
) => bracket(
  assertSync(() => f(queue)),
  disposable => ok(dispose(disposable)),
  _ => fromDequeue(key, queue)
)

/**
 * Create a scoped yield source from an Iterable.
 */
export const fromIterable = <const Key extends AnyKey & Yielding<unknown, void>, R>(
  key: Key,
  i: IterableWithReturn<YieldOutput<Key>, R>
): Fx<YieldFrom<Key> | Interrupt, IfAny<R, void>> => bracket(
  assertSync(() => i[Symbol.iterator]()),
  iterator => ok(void iterator.return?.()),
  iterator => fx(function* () {
    let result = iterator.next()
    while (!result.done) {
      yield* yieldFrom(key, result.value)
      result = iterator.next()
    }
    return result.value
  })
) as Fx<YieldFrom<Key> | Interrupt, IfAny<R, void>>

/**
 * Create a scoped yield source from an AsyncIterable.
 */
export const fromAsyncIterable = <const Key extends AnyKey & Yielding<unknown, void>, R>(
  key: Key,
  f: () => AsyncIterableWithReturn<YieldOutput<Key>, R>
): Fx<Async | YieldFrom<Key> | Interrupt, R> => bracket(
  assertSync(() => f()[Symbol.asyncIterator]()),
  iterator => assertPromise(() => iterator.return?.().then(() => { }) ?? Promise.resolve()),
  iterator => fx(function* () {
    const next = assertPromise(() => iterator.next())
    let result = yield* next
    while (!result.done) {
      yield* yieldFrom(key, result.value)
      result = yield* next
    }
    return result.value
  })
)

export const toAsyncIterable = <const Key extends AnyKey & Yielding<unknown, void>, E extends Async | YieldFrom<Key> | Fail<any>, A>(
  key: Key,
  f: Fx<E, A>
): AsyncIterableWithReturn<YieldValue<E, Key>, A> => ({
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
          } else if (YieldFrom.is(next) && sameKey(next.key, key)) {
            yield next.arg as YieldValue<E, Key>
            result = iterator.next()
          } else {
            throw new Error(`Unexpected effect while converting YieldFrom key ${keyLabel(key)} to AsyncIterable`)
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
 * Pipe all one-way yields from one scope into a sink from another scope.
 */
export const to = <
  const SourceKey extends AnyKey & Yielding<unknown, void>,
  const SinkKey extends AnyKey & Receiving<YieldOutput<SourceKey>>,
  E1,
  E2,
  R1,
  R2
>(
  sourceKey: SourceKey,
  sinkKey: SinkKey,
  source: Fx<E1, R1>,
  sink: Fx<E2, R2>
): Fx<ExcludeYieldFrom<E1, SourceKey> | ExcludeSink<E2, SinkKey>, PipeResult<R1, R2>> => fx(function* () {
  const sourceIterator = source[Symbol.iterator]()
  const sinkIterator = sink[Symbol.iterator]()
  let sourceOpen = true
  let sinkOpen = true

  const drainSource = function* (
    result: IteratorResult<E1, R1>
  ): Generator<ExcludeYieldFrom<E1, SourceKey> | ExcludeSink<E2, SinkKey>, R1, unknown> {
    while (!result.done) {
      const effect = result.value
      result = YieldFrom.is(effect) && sameKey(effect.key, sourceKey)
        ? sourceIterator.next(undefined as YieldInput<SourceKey>)
        : sourceIterator.next(yield effect as ExcludeYieldFrom<E1, SourceKey>)
    }
    return result.value
  }

  const drainSink = function* (
    result: IteratorResult<E2, R2>
  ): Generator<ExcludeYieldFrom<E1, SourceKey> | ExcludeSink<E2, SinkKey>, R2, unknown> {
    while (!result.done) {
      const effect = result.value
      result = Sink.is(effect) && sameKey(effect.key, sinkKey)
        ? sinkIterator.next(undefined as SinkInput<SinkKey>)
        : sinkIterator.next(yield effect as ExcludeSink<E2, SinkKey>)
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
      while (!sinkResult.done && !sourceResult.done && !(YieldFrom.is(sourceResult.value) && sameKey(sourceResult.value.key, sourceKey))) {
        sourceResult = sourceIterator.next(yield sourceResult.value as ExcludeYieldFrom<E1, SourceKey>)
      }

      while (!sourceResult.done && !sinkResult.done && !(Sink.is(sinkResult.value) && sameKey(sinkResult.value.key, sinkKey))) {
        sinkResult = sinkIterator.next(yield sinkResult.value as ExcludeSink<E2, SinkKey>)
      }

      if (sinkResult.done) {
        sinkOpen = false
        if (sourceResult.done) sourceOpen = false
        yield* closeSource()
        return { type: 'sinkEnded', value: sinkResult.value }
      }

      if (sourceResult.done) {
        sourceOpen = false
        yield* closeSink()
        return { type: 'sourceEnded', value: sourceResult.value }
      }

      sinkResult = sinkIterator.next((sourceResult.value as YieldFrom<SourceKey>).arg)
      if (!sinkResult.done) sourceResult = sourceIterator.next()
    }
  } finally {
    yield* closeSource()
    yield* closeSink()
  }
}) as Fx<ExcludeYieldFrom<E1, SourceKey> | ExcludeSink<E2, SinkKey>, PipeResult<R1, R2>>
