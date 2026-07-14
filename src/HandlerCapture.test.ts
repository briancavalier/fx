import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from './Effect.js'
import { Fx, fx, ok, run } from './Fx.js'
import { handle } from './Handler.js'
import { captureHandlers, closeHandlerCapture, withHandlerContext, type CapturedHandler } from './HandlerCapture.js'

describe('HandlerCapture', () => {
  it('allows user code to capture and apply named handlers', () => {
    class CurrentValue extends Effect('test/HandlerCapture/CurrentValue')<[], string> { }

    const context = captureHandlers('test/scope').pipe(
      handle(CurrentValue, () => ok('handled')),
      closeHandlerCapture('test/scope'),
      run
    )
    const result = run(withHandlerContext(context, new CurrentValue()) as Fx<never, string>)

    assert.equal(result, 'handled')
  })

  it('does not stop capture at a differently named handler boundary', () => {
    class CurrentValue extends Effect('test/HandlerCapture/ForwardedValue')<[], string> { }

    const context = captureHandlers('test/target').pipe(
      closeHandlerCapture('test/other'),
      handle(CurrentValue, () => ok('handled')),
      closeHandlerCapture('test/target'),
      run
    )
    const result = run(withHandlerContext(context, new CurrentValue()) as Fx<never, string>)

    assert.equal(result, 'handled')
  })

  describe('closeHandlerCapture', () => {
    it('stops matching handler capture at the matching boundary', () => {
      class Outer extends Effect('test/HandlerCapture/Outer')<[], string> { }

      const context = captureHandlers('target').pipe(
        closeHandlerCapture('target'),
        handle(Outer, () => ok('outer')),
        closeHandlerCapture('target'),
        run
      )

      assert.equal(context.length, 0)
    })

    it('forwards non-matching handler capture to an outer matching boundary', () => {
      class Outer extends Effect('test/HandlerCapture/ForwardOuter')<[], string> { }

      const context = captureHandlers('target').pipe(
        closeHandlerCapture('other'),
        handle(Outer, () => ok('outer')),
        closeHandlerCapture('target'),
        run
      )
      const result = run(withHandlerContext(context, new Outer()) as Fx<never, string>)

      assert.equal(context.length, 1)
      assert.equal(result, 'outer')
    })

    it('captures ordinary handlers between captureHandlers and closeHandlerCapture', () => {
      class Local extends Effect('test/HandlerCapture/Local')<[], string> { }

      const context = captureHandlers('target').pipe(
        handle(Local, () => ok('local')),
        closeHandlerCapture('target'),
        run
      )
      const result = run(withHandlerContext(context, new Local()) as Fx<never, string>)

      assert.equal(context.length, 1)
      assert.equal(result, 'local')
    })

    it('applies captured context by wrapping target Fx', () => {
      let wraps = 0

      const context: readonly CapturedHandler[] = [{
        wrap(f: Fx<unknown, unknown>): Fx<unknown, unknown> {
          wraps += 1
          return fx(function* () {
            const value = yield* f
            return `${wraps}:${String(value)}`
          })
        }
      }]

      const f = ok('value')

      const runWithContext = () =>
        run(withHandlerContext(context, f) as Fx<never, string>)

      assert.equal(runWithContext(), '1:value')
      assert.equal(runWithContext(), '2:value')
      assert.equal(wraps, 2)
    })

    it('does not capture handler boundaries as handler context', () => {
      const context = captureHandlers('target').pipe(
        closeHandlerCapture('other'),
        closeHandlerCapture('target'),
        run
      )

      assert.equal(context.length, 0)
    })
  })
})
