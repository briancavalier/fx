import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Fx from './Fx'
import * as Stream from './Stream'
import * as Fork from './Fork'
import * as Async from './Async'
import { EventEmitter } from 'node:events'

describe('Stream', () => {
  it('allows emitting events and observing those events', async () => {
    const producer = Fx.fx(function* () {
      for (let i = 0; i < 25; i++) { 
        yield* Stream.event(i)
      }
    }).pipe(
      _ => Stream.filter(_, a => a % 2 === 0),
      _ => Stream.map(_, a => a * 2)
    )
    const test = collectAll(producer)

    assert.deepEqual(Fx.runSync(test), [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48])
  })

  describe('switchMap', () => { 
    it('allows chaining multiple streams, favoring the latest', async () => {
      const test = Fx.fx(function* () {
        for (let i = 0; i < 25; i++) { 
          yield* Stream.event(i)
        }
      }).pipe(
        _ => Stream.switchMap(_, a => Fx.fx(function* () {
          yield* Stream.event(String(a))
          yield* Stream.event(BigInt(a))
        })),
        collectAll,
        Fork.unbounded,
      )
      const task = Fx.runAsync(test)
      
      assert.deepEqual(await task.promise, ['24', 24n])
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
        // Give emits time to start their own fibers
        yield* Async.sleep(1)
      })
      const producer = Stream.withEmitter<number, Fork.Fork>(emitter => Fx.fx(function* () { 
        eventEmitter.on('event', emitter.event)
        return {
          [Symbol.dispose]() { 
            eventEmitter.off('event', emitter.event)
            emitter.end()
          }
        }
      }))

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
})

function collectAll<E, A>(fx: Fx.Fx<E, A>): Fx.Fx<Stream.ExcludeStream<E>, readonly Stream.Event<E>[]> {
  return Fx.fx(function* () {
    const events: Stream.Event<E>[] = []
    yield* Stream.forEach(fx, a => { 
      events.push(a)
      return Fx.unit
    })
    return events
  })
}