import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Fx from './Fx'
import * as Stream from './Stream'
import { unbounded } from './Fork'

describe('Stream', () => {
  it("allows emitting events and observing those events", async () => {
    const producer = Fx.fx(function* () {
      for (let i = 0; i < 25; i++) { 
        yield* Stream.event(i)
      }
    }).pipe(
      (_) => Stream.filter(_, a => a % 2 === 0),
      (_) => Stream.map(_, a => a * 2)
    )
    const test = collectAll(producer)

    assert.deepEqual(Fx.runSync(test), [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48])
  })

  describe("switchMap", () => { 
    it("allows chaining multiple streams, favoring the latest", async () => {
      const test = Fx.fx(function* () {
        for (let i = 0; i < 25; i++) { 
          yield* Stream.event(i)
        }
      }).pipe(
        (_) => Stream.switchMap(_, a => Fx.fx(function* () {
          yield* Stream.event(String(a))
          yield* Stream.event(BigInt(a))
        })),
        collectAll,
        unbounded,
      )
      const task = Fx.runAsync(test)
      
      assert.deepEqual(await task.promise, ["24", 24n])
    })
  })
})

function collectAll<E, A>(fx: Fx.Fx<E, A>): Fx.Fx<Stream.ExcludeStream<E>, readonly Stream.Event<E>[]> {
  return Fx.fx(function* () {
    const events: Stream.Event<E>[] = []
    yield* Stream.observe(fx, a => { 
      events.push(a)
      return Fx.unit
    })
    return events
  })
}