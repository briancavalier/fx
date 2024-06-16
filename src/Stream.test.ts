import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Abort from './Abort'
import * as Fork from './Fork'
import * as Fx from './Fx'
import * as Sink from './Sink'
import * as Stream from './Stream'
import { Enqueue, UnboundedQueue } from './internal/Queue'
import { dispose } from './internal/disposable'

describe('Stream', () => {
  it('allows emitting events and observing those events', () => {
    const [r, events] = Fx.fx(function* () {
      for (let i = 0; i < 25; i++) yield* Stream.emit(i)
      return 42
    }).pipe(
      _ => Stream.filter(_, a => a % 2 === 0),
      _ => Stream.map(_, a => a * 2),
      collectAll,
      Fx.runSync
    )

    assert.equal(r, 42)
    assert.deepEqual(events, [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48])
  })

  describe('repeat', () => {
    it('given effectful computation, forces it repeatedly', () => {
      const x = Math.random()
      const n = Math.floor(Math.random() * 100)
      const [r, events] = Stream.repeat(Fx.ok(x)).pipe(
        Stream.take(n),
        Abort.orReturn(n),
        collectAll,
        Fx.runSync
      )

      assert.equal(r, n)
      assert.deepEqual(events, Array.from({ length: n }, () => x))
    })
  })

  describe('take', () => {
    it('given stream with proportion > n, takes n values', () => {
      const n = 10
      const a = Array.from({ length: n }, (_, i) => i)
      const [r, events] = Fx.fx(function* () {
        for (const x of a) yield* Stream.emit(x)
        return 'done'
      }).pipe(
        Stream.take(n - 1),
        Abort.orReturn('aborted'),
        collectAll,
        Fx.runSync
      )

      assert.equal(r, 'aborted')
      assert.deepEqual(events, a.slice(0, n - 1))
    })

    it('given stream with proportion <= n, takes all values', () => {
      const n = 10
      const a = Array.from({ length: n }, (_, i) => i)
      const [r, events] = Fx.fx(function* () {
        for (const x of a) yield* Stream.emit(x)
        return 'done'
      }).pipe(
        Stream.take(n),
        Abort.orReturn('aborted'),
        collectAll,
        Fx.runSync
      )

      assert.equal(r, 'done')
      assert.deepEqual(events, a)
    })
  })

  describe('switchMap', () => {
    it('allows chaining multiple streams, favoring the latest', async () => {
      const [r, events] = await Fx.fx(function* () {
        for (let i = 0; i < 25; i++) yield* Stream.emit(i)
        return 42
      }).pipe(
        _ => Stream.switchMap(_, a => Fx.fx(function* () {
          yield* Stream.emit(String(a))
          yield* Stream.emit(BigInt(a))
        })),
        collectAll,
        Fork.unbounded,
        Fx.runAsync
      ).promise

      assert.equal(r, 42)
      assert.deepEqual(events, ['24', 24n])
    })
  })

  describe('fromDequeue', () => {
    it('given queue, produces all enqueued items', async () => {
      const expected = Array.from({ length: 10 }, (_, i) => i)

      const queue = new UnboundedQueue<number>()

      enqueueAllAsync(queue, expected)

      const [r, events] = await Stream.fromDequeue(queue)
        .pipe(collectAll, Fx.runAsync)
        .promise

      assert.equal(r, undefined)
      assert.deepEqual(events, expected)
    })
  })

  describe('withEnqueue', () => {
    it('adapts a callback-based API', async () => {
      const expected = Array.from({ length: 10 }, (_, i) => i)

      const queue = new UnboundedQueue<number>()
      let disposed = false

      const [r, events] = await Stream.withEnqueue(q => {
        enqueueAllAsync(q, expected)

        return {
          [Symbol.dispose]: () => { disposed = true }
        }
      }, queue)
        .pipe(collectAll, Fx.runAsync)
        .promise

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

      const [r, events] = Stream.fromIterable(makeIterable())
        .pipe(collectAll, Fx.runSync)

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

      const [r, events] = await Stream.fromAsyncIterable(makeAsyncGenerator)
        .pipe(collectAll, Fx.runAsync)
        .promise

      assert.equal(r, 42)
      assert.deepEqual(events, inputs)
    })
  })

  describe('toAsyncIterable', () => {
    it('converts a stream to an async iterable', async () => {
      const inputs = Array.from({ length: 25 }, (_, i) => i)

      const fx = Fx.fx(function* () {
        for (const i of inputs) {
          yield* Stream.emit(i)
          yield* Stream.emit(String(i))
        }

        return 42
      })
      const asyncIterable = Stream.toAsyncIterable(fx)

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

  describe('to', () => {
    it('given stream < sink, has stream proportion and prefers sink return value', () => {
      const expected = [1, 2, 3]
      const stream = Stream.fromIterable(expected).pipe(Fx.map(_ => 'stream'))

      const actual: number[] = []
      const sink = Fx.fx(function* () {
        while (true) actual.push(yield* Sink.next<number>())
      })

      const r = stream.pipe(_ => Stream.to(_, sink), Fx.runSync)

      assert.equal(r, undefined)
      assert.deepEqual(actual, expected)
    })

    it('given stream > sink, has sink proportion and prefers sink return value', () => {
      const stream = Fx.fx(function* () {
        let i = 1
        while (true) yield* Stream.emit(i++)
      })

      const actual: number[] = []
      const sink = Fx.fx(function* () {
        let i = 3
        while (--i >= 0) actual.push(yield* Sink.next<number>())
        return 'sink'
      })

      const r = stream.pipe(_ => Stream.to(_, sink), Fx.runSync)

      assert.equal(r, 'sink')
      assert.deepEqual(actual, [1, 2, 3])
    })

    it('given stream ~ sink, has expected proportion and prefers sink return value', () => {
      const expected = [1, 2, 3]
      const stream = Stream.fromIterable(expected).pipe(Fx.map(_ => 'stream'))

      const actual: number[] = []
      const sink = Fx.fx(function* () {
        let i = expected.length
        while (--i >= 0) actual.push(yield* Sink.next<number>())
        return 'sink'
      })

      const r = stream.pipe(_ => Stream.to(_, sink), Fx.runSync)

      assert.equal(r, 'sink')
      assert.deepEqual(actual, expected)
    })
  })
})

function collectAll<E, A>(fx: Fx.Fx<E, A>): Fx.Fx<Stream.ExcludeStream<E>, readonly [A, readonly Stream.Event<E>[]]> {
  return Fx.fx(function* () {
    const events: Stream.Event<E>[] = []
    const r: A = yield* Stream.forEach(fx, a => {
      events.push(a)
      return Fx.unit
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
