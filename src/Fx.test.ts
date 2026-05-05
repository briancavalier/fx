import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise } from './Async.js'
import { Effect } from './Effect.js'
import { Fail, returnFail } from './Fail.js'
import { assertSync, flatMap, fx, ok, run, runPromise, runTask, trySync } from './Fx.js'
import { handle } from './Handler.js'

describe('Fx', () => {
  describe('fx', () => {
    it('given this arg, executes generator with it', () => {
      const expected = { foo: 'bar' }
      const actual = fx(expected, function* () {
        return this
      }).pipe(run)

      assert.equal(actual, expected)
    })

    it('given no this arg, executes generator with undefined', () => {
      const actual = fx(function* () {
        // @ts-expect-error `this` is not set
        return this
      }).pipe(run)

      assert.equal(actual, undefined)
    })
  })

  describe('flatMap', () => {
    it('given mapping function, returns result', () => {
      const r = ok(1).pipe(flatMap(x => ok(x + 1)), run)
      assert.equal(r, 2)
    })

    it('given mapping function with effect, merges effects', () => {
      class E1<A> extends Effect('E1')<A, A> { }
      class E2<A> extends Effect('E2')<A, A> { }

      const r = new E1(1).pipe(
        flatMap(a => new E2(`${a}`)),
        handle(E1, ok),
        handle(E2, ok),
        run
      )

      assert.equal(r, '1')
    })

    it('has ok as left identity', () => {
      const x = Math.random()
      const r1 = ok(x).pipe(flatMap(x => ok(x + 1)), run)
      const r2 = ok(x).pipe(flatMap(ok), flatMap(x => ok(x + 1)), run)
      assert.equal(r1, r2)
    })

    it('has ok as right identity', () => {
      const x = Math.random()
      const r1 = ok(x).pipe(flatMap(x => ok(x + 1)), run)
      const r2 = ok(x).pipe(flatMap(x => ok(x + 1)), flatMap(ok), run)
      assert.equal(r1, r2)
    })

    it('is associative', () => {
      const x = Math.random()
      const f = (x: number) => ok(x + 1)
      const g = (x: number) => ok(x * 2)

      const r1 = ok(x).pipe(flatMap(f), flatMap(g), run)
      const r2 = ok(x).pipe(flatMap(x => f(x).pipe(flatMap(g))), run)
      assert.equal(r1, r2)
    })
  })

  describe('assertSync', () => {
    it('given thunk, returns result', () => {
      const x = Math.random()
      const r = assertSync(() => x).pipe(run)
      assert.equal(r, x)
    })

    it('given thunk throws, throws', () => {
      const e = new Error()
      assert.throws(() => assertSync(() => { throw e }).pipe(run), e)
    })
  })

  describe('trySync', () => {
    it('given thunk, returns result', () => {
      const x = Math.random()
      const r = trySync(() => x).pipe(returnFail, run)
      assert.equal(r, x)
    })

    it('given thunk throws, produces Fail', () => {
      const e = new Error()
      const r = trySync(() => { throw e }).pipe(returnFail, run)
      assert.ok(Fail.is(r))
      assert.equal(r.arg, e)
    })
  })

  describe('runTask', () => {
    it('captures the runTask call site as the default origin', async () => {
      const cause = new Error('runTask failed')

      await assert.rejects(
        runTask(assertPromise(() => Promise.reject(cause))).promise,
        e => e instanceof Error
          && firstLine(e).includes('fx/runTask')
          && (e.stack ?? '').includes('Fx.test.ts')
          && e.cause === cause
      )
    })
  })

  describe('runPromise', () => {
    it('captures the runPromise call site as the default origin', async () => {
      const cause = new Error('runPromise failed')

      await assert.rejects(
        runPromise(assertPromise(() => Promise.reject(cause))),
        e => e instanceof Error
          && firstLine(e).includes('fx/runPromise')
          && (e.stack ?? '').includes('Fx.test.ts')
          && e.cause === cause
      )
    })
  })
})

const firstLine = (e: Error): string =>
  e.stack?.split('\n')[0] ?? ''
