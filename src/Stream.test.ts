import * as assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import * as Async from './Async'
import * as Fork from './Fork'
import * as Fx from './Fx'
import * as Stream from './Stream'

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
      const eventEmitter = new EventEmitter<{ event: [number] }>()
      const emit = (...values: number[]) => Fx.fx(function* () {
        // Give fiber time to start
        yield* Async.sleep(1)
        for (const value of values) {
          eventEmitter.emit('event', value)
        }
        // Give emits time to start their own tasks
        yield* Async.sleep(1)
      })
      const producer = Stream.withEmitter<number>(emitter => {
        eventEmitter.on('event', emitter.event)
        return {
          [Symbol.dispose]() {
            eventEmitter.off('event', emitter.event)
            emitter.end()
          }
        }
      })

      const test = Fx.fx(function* () {
        const events: number[] = []
        const task = yield* Fork.fork(Stream.forEach(producer, a => {
          events.push(a)
          return Fx.unit
        }))
        yield* emit(0, 1, 2, 3)
        assert.deepEqual(events, [0, 1, 2, 3])
        yield* emit(4, 5, 6, 7)
        assert.deepEqual(events, [0, 1, 2, 3, 4, 5, 6, 7])
        task[Symbol.dispose]()
      }).pipe(
        Fork.unbounded
      )

      await Fx.runAsync(test).promise
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
