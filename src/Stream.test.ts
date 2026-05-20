import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { orReturn } from './Abort.js'
import { unbounded } from './Concurrent.js'
import { fx, ok, run, runPromise, unit, type Fx } from './Fx.js'
import { scope } from './Scope.js'
import {
  emit,
  filter,
  forEach,
  fromAsyncIterable,
  fromDequeue,
  fromIterable,
  map,
  repeat,
  switchMap,
  take,
  TakeScope,
  toAsyncIterable,
  withEnqueue,
  type Event,
  type ExcludeStream
} from './Stream.js'
import { Enqueue, UnboundedQueue } from './internal/Queue.js'
import { dispose } from './internal/disposable.js'

describe('Stream', () => {
  it('allows emitting events and observing those events', () => {
    const [r, events] = fx(function* () {
      for (let i = 0; i < 25; i++) yield* emit(i)
      return 42
    }).pipe(
      _ => filter(_, a => a % 2 === 0),
      _ => map(_, a => a * 2),
      collectAll,
      run
    )

    assert.equal(r, 42)
    assert.deepEqual(events, [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48])
  })

  describe('repeat', () => {
    it('given effectful computation, forces it repeatedly', () => {
      const x = Math.random()
      const n = Math.floor(Math.random() * 100)
      const [r, events] = repeat(ok(x)).pipe(
        take(n),
        scope(TakeScope),
        orReturn(TakeScope, n),
        collectAll,
        run
      )

      assert.equal(r, n)
      assert.deepEqual(events, Array.from({ length: n }, () => x))
    })
  })

  describe('take', () => {
    it('given stream with proportion > n, takes n values', () => {
      const n = 10
      const a = Array.from({ length: n }, (_, i) => i)
      const [r, events] = fx(function* () {
        for (const x of a) yield* emit(x)
        return 'done'
      }).pipe(
        take(n - 1),
        scope(TakeScope),
        orReturn(TakeScope, 'aborted'),
        collectAll,
        run
      )

      assert.equal(r, 'aborted')
      assert.deepEqual(events, a.slice(0, n - 1))
    })

    it('given stream with proportion <= n, takes all values', () => {
      const n = 10
      const a = Array.from({ length: n }, (_, i) => i)
      const [r, events] = fx(function* () {
        for (const x of a) yield* emit(x)
        return 'done'
      }).pipe(
        take(n),
        scope(TakeScope),
        orReturn(TakeScope, 'aborted'),
        collectAll,
        run
      )

      assert.equal(r, 'done')
      assert.deepEqual(events, a)
    })
  })

  describe('switchMap', () => {
    it('allows chaining multiple streams, favoring the latest', async () => {
      const [r, events] = await fx(function* () {
        for (let i = 0; i < 25; i++) yield* emit(i)
        return 42
      }).pipe(
        _ => switchMap(_, a => fx(function* () {
          yield* emit(String(a))
          yield* emit(BigInt(a))
        })),
        collectAll,
        unbounded,
        runPromise
      )

      assert.equal(r, 42)
      assert.deepEqual(events, ['24', 24n])
    })
  })

  describe('fromDequeue', () => {
    it('given queue, produces all enqueued items', async () => {
      const expected = Array.from({ length: 10 }, (_, i) => i)

      const queue = new UnboundedQueue<number>()

      enqueueAllAsync(queue, expected)

      const [r, events] = await fromDequeue(queue)
        .pipe(collectAll, runPromise)

      assert.equal(r, undefined)
      assert.deepEqual(events, expected)
    })
  })

  describe('withEnqueue', () => {
    it('adapts a callback-based API', async () => {
      const expected = Array.from({ length: 10 }, (_, i) => i)

      const queue = new UnboundedQueue<number>()
      let disposed = false

      const [r, events] = await withEnqueue(q => {
        enqueueAllAsync(q, expected)

        return {
          [Symbol.dispose]: () => { disposed = true }
        }
      }, queue)
        .pipe(collectAll, runPromise)

      assert.equal(r, undefined)
      assert.deepEqual(events, expected)
      assert.ok(disposed)
      assert.ok(queue.disposed)
    })
  })

  describe('fromIterable', () => {
    it('converts an iterable to a stream', () => {
      const inputs = Array.from({ length: 25 }, (_, i) => i)

      function* makeIterable() {
        yield* inputs
        return 42
      }

      const [r, events] = fromIterable(makeIterable())
        .pipe(collectAll, run)

      assert.equal(r, 42)
      assert.deepEqual(events, inputs)
    })
  })


  describe('fromAsyncIterable', () => {
    it('converts an async iterable to a stream', async () => {
      const inputs = Array.from({ length: 25 }, (_, i) => i)

      async function* makeAsyncGenerator() {
        for (const i of inputs) yield Promise.resolve(i)
        return 42
      }

      const [r, events] = await fromAsyncIterable(makeAsyncGenerator)
        .pipe(collectAll, runPromise)

      assert.equal(r, 42)
      assert.deepEqual(events, inputs)
    })
  })

  describe('toAsyncIterable', () => {
    it('converts a stream to an async iterable', async () => {
      const inputs = Array.from({ length: 25 }, (_, i) => i)

      const streamFx = fx(function* () {
        for (const i of inputs) {
          yield* emit(i)
          yield* emit(String(i))
        }

        return 42
      })
      const asyncIterable = toAsyncIterable(streamFx)

      const events = []
      const iterator = asyncIterable[Symbol.asyncIterator]()
      let result = await iterator.next()
      while (!result.done) {
        events.push(result.value)
        result = await iterator.next()
      }
      assert.deepEqual(events, inputs.flatMap(i => [i, String(i)]))
      assert.deepEqual(result.value, 42)
    })
  })
})

function collectAll<E, A>(f: Fx<E, A>): Fx<ExcludeStream<E>, readonly [A, readonly Event<E>[]]> {
  return fx(function* () {
    const events: Event<E>[] = []
    const r: A = yield* forEach(f, a => {
      events.push(a)
      return unit
    })
    return [r, events]
  })
}

const enqueueAllAsync = <A>(queue: Enqueue<A>, values: readonly A[]) => {
  if (values.length === 0) return dispose(queue)

  const [a, ...rest] = values
  queue.enqueue(a)
  setTimeout(enqueueAllAsync, 0, queue, rest)
}
