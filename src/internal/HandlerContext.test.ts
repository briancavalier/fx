import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from '../Effect.js'
import { Fx, run } from '../Fx.js'
import { handle } from '../Handler.js'
import { ok } from '../Fx.js'
import { handleScoped, scoped, withContext } from './HandlerContext.js'

describe('HandlerContext', () => {
  describe('handleScoped', () => {
    it('stops matching scoped capture at the matching boundary', () => {
      class Outer extends Effect('test/HandlerContext/Outer')<void, string> { }

      const context = scoped('target').pipe(
        handleScoped('target'),
        handle(Outer, () => ok('outer')),
        handleScoped('target'),
        run
      )

      assert.equal(context.length, 0)
    })

    it('forwards non-matching scoped capture to an outer matching boundary', () => {
      class Outer extends Effect('test/HandlerContext/ForwardOuter')<void, string> { }

      const context = scoped('target').pipe(
        handleScoped('other'),
        handle(Outer, () => ok('outer')),
        handleScoped('target'),
        run
      )
      const result = run(withContext(context, new Outer()) as Fx<never, string>)

      assert.equal(context.length, 1)
      assert.equal(result, 'outer')
    })

    it('captures ordinary handlers between scoped and handleScoped', () => {
      class Local extends Effect('test/HandlerContext/Local')<void, string> { }

      const context = scoped('target').pipe(
        handle(Local, () => ok('local')),
        handleScoped('target'),
        run
      )
      const result = run(withContext(context, new Local()) as Fx<never, string>)

      assert.equal(context.length, 1)
      assert.equal(result, 'local')
    })

    it('does not capture scope boundaries as handler context', () => {
      const context = scoped('target').pipe(
        handleScoped('other'),
        handleScoped('target'),
        run
      )

      assert.equal(context.length, 0)
    })
  })
})
