import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from './Effect'
import { flatMap, handle, ok, runSync } from './Fx'

describe('Fx', () => {
  describe('flatMap', () => {
    it('given mapping function, returns result', () => {
      const r = ok(1).pipe(flatMap(x => ok(x + 1)), runSync)
      assert.equal(r, 2)
    })

    it('given mapping function with effect, merges effects', () => {
      class E1<A> extends Effect('E1')<A, A> { }
      class E2<A> extends Effect('E2')<A, A> { }

      const r = new E1(1).pipe(
        flatMap(a => new E2(`${a}`)),
        handle(E1, ok),
        handle(E2, ok),
        runSync
      )

      assert.equal(r, '1')
    })

    it('has ok as left identity', () => {
      const x = Math.random()
      const r1 = ok(x).pipe(flatMap(x => ok(x + 1)), runSync)
      const r2 = ok(x).pipe(flatMap(ok), flatMap(x => ok(x + 1)), runSync)
      assert.equal(r1, r2)
    })

    it('has ok as right identity', () => {
      const x = Math.random()
      const r1 = ok(x).pipe(flatMap(x => ok(x + 1)), runSync)
      const r2 = ok(x).pipe(flatMap(x => ok(x + 1)), flatMap(ok), runSync)
      assert.equal(r1, r2)
    })

    it('is associative', () => {
      const x = Math.random()
      const f = (x: number) => ok(x + 1)
      const g = (x: number) => ok(x * 2)

      const r1 = ok(x).pipe(flatMap(f), flatMap(g), runSync)
      const r2 = ok(x).pipe(flatMap(x => f(x).pipe(flatMap(g))), runSync)
      assert.equal(r1, r2)
    })
  })
})
