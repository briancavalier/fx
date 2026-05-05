import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from './Effect.js'
import { Fx, ok, run } from './Fx.js'
import { handle } from './Handler.js'
import { captureScoped, closeScoped, withContext } from './Scoped.js'

describe('Scoped', () => {
  it('allows user code to capture and apply a named handler scope', () => {
    class CurrentValue extends Effect('test/Scoped/CurrentValue')<void, string> { }

    const context = captureScoped('test/scope').pipe(
      handle(CurrentValue, () => ok('handled')),
      closeScoped('test/scope'),
      run
    )
    const result = run(withContext(context, new CurrentValue()) as Fx<never, string>)

    assert.equal(result, 'handled')
  })

  it('does not stop capture at a differently named scope boundary', () => {
    class CurrentValue extends Effect('test/Scoped/ForwardedValue')<void, string> { }

    const context = captureScoped('test/target').pipe(
      closeScoped('test/other'),
      handle(CurrentValue, () => ok('handled')),
      closeScoped('test/target'),
      run
    )
    const result = run(withContext(context, new CurrentValue()) as Fx<never, string>)

    assert.equal(result, 'handled')
  })

  describe('closeScoped', () => {
    it('stops matching scoped capture at the matching boundary', () => {
      class Outer extends Effect('test/Scoped/Outer')<void, string> { }

      const context = captureScoped('target').pipe(
        closeScoped('target'),
        handle(Outer, () => ok('outer')),
        closeScoped('target'),
        run
      )

      assert.equal(context.length, 0)
    })

    it('forwards non-matching scoped capture to an outer matching boundary', () => {
      class Outer extends Effect('test/Scoped/ForwardOuter')<void, string> { }

      const context = captureScoped('target').pipe(
        closeScoped('other'),
        handle(Outer, () => ok('outer')),
        closeScoped('target'),
        run
      )
      const result = run(withContext(context, new Outer()) as Fx<never, string>)

      assert.equal(context.length, 1)
      assert.equal(result, 'outer')
    })

    it('captures ordinary handlers between captureScoped and closeScoped', () => {
      class Local extends Effect('test/Scoped/Local')<void, string> { }

      const context = captureScoped('target').pipe(
        handle(Local, () => ok('local')),
        closeScoped('target'),
        run
      )
      const result = run(withContext(context, new Local()) as Fx<never, string>)

      assert.equal(context.length, 1)
      assert.equal(result, 'local')
    })

    it('does not capture scope boundaries as handler context', () => {
      const context = captureScoped('target').pipe(
        closeScoped('other'),
        closeScoped('target'),
        run
      )

      assert.equal(context.length, 0)
    })
  })
})
