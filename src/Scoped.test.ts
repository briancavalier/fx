import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from './Effect.js'
import { Fx, ok, run } from './Fx.js'
import { handle } from './Handler.js'
import { handleScoped, scoped, withContext } from './Scoped.js'

describe('Scoped', () => {
  it('allows user code to capture and apply a named handler scope', () => {
    class CurrentValue extends Effect('test/Scoped/CurrentValue')<void, string> { }

    const context = scoped('test/scope').pipe(
      handle(CurrentValue, () => ok('handled')),
      handleScoped('test/scope'),
      run
    )
    const result = run(withContext(context, new CurrentValue()) as Fx<never, string>)

    assert.equal(result, 'handled')
  })

  it('does not stop capture at a differently named scope boundary', () => {
    class CurrentValue extends Effect('test/Scoped/ForwardedValue')<void, string> { }

    const context = scoped('test/target').pipe(
      handleScoped('test/other'),
      handle(CurrentValue, () => ok('handled')),
      handleScoped('test/target'),
      run
    )
    const result = run(withContext(context, new CurrentValue()) as Fx<never, string>)

    assert.equal(result, 'handled')
  })
})
