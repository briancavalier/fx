import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Fork from './Fork'
import * as Fx from './Fx'
import * as Stream from './Stream'
import { UnboundedQueue } from './internal/Queue'
import { dispose } from './internal/disposable'

describe('Stream', () => {
  it('allows emitting events and observing those events', async () => {
    const producer = Fx.fx(function* () {
      for (let i = 0; i < 25; i++) yield* Stream.event(i)
      return 42
    }).pipe(
      _ => Stream.filter(_, a => a % 2 === 0),
      _ => Stream.map(_, a => a * 2),
      collectAll
    )

    const [r, events] = Fx.runSync(producer)

    assert.equal(r, 42)
    assert.deepEqual(events, [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48])
  })

  describe('switchMap', () => {
    it('allows chaining multiple streams, favoring the latest', async () => {
      const test = Fx.fx(function* () {
        for (let i = 0; i < 25; i++) yield* Stream.event(i)
        return 42
      }).pipe(
        _ => Stream.switchMap(_, a => Fx.fx(function* () {
          yield* Stream.event(String(a))
          yield* Stream.event(BigInt(a))
        })),
        collectAll,
        Fork.unbounded,
      )

      const [r, events] = await Fx.runAsync(test).promise

      assert.equal(r, 42)
      assert.deepEqual(events, ['24', 24n])
    })
  })

  describe('withEmitter', () => {
    it('adapts a callback-based API', async () => {

      const expected = Array.from({ length: 10 }, (_, i) => i)

      const queue = new UnboundedQueue<number>()
      let disposed = false

      const [r, events] = await Stream.withEnqueue(q => {
        const emit = (values: readonly number[]) => {
          if (values.length === 0) return dispose(q)

          const [a, ...rest] = values
          q.enqueue(a)
          setTimeout(emit, 0, rest)
        }

        emit(expected)

        return {
          [Symbol.dispose]: () => { disposed = true }
        }
      }, queue).pipe(
        collectAll,
        Fork.unbounded,
        Fx.runAsync
      ).promise

      assert.equal(r, undefined)
      assert.deepEqual(events, expected)
      assert.ok(disposed)
      assert.ok(queue.disposed)
    })
  })

  describe('fromIterable', () => {
    it('converts an iterable to a stream', async () => {
      const inputs = Array.from({ length: 25 }, (_, i) => i)

      function* makeIterable() {
        yield* inputs
        return 42
      }

      const [r, events] = Fx.runSync(
        Stream.fromIterable(makeIterable()).pipe(collectAll)
      )

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

      const [r, events] = await Fx.runAsync(
        Stream.fromAsyncIterable(makeAsyncGenerator).pipe(collectAll)
      ).promise

      assert.equal(r, 42)
      assert.deepEqual(events, inputs)
    })
  })

  describe('toAsyncIterable', () => {
    it('converts a stream to an async iterable', async () => {
      const inputs = Array.from({ length: 25 }, (_, i) => i)

      const fx = Fx.fx(function* () {
        for (const i of inputs) {
          yield* Stream.event(i)
          yield* Stream.event(String(i))
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
