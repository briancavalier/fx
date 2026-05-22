import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, run } from './Fx.js'
import { ReturnFrom, returnFrom } from './ReturnFrom.js'
import { scope, withScope } from './Scope.js'

describe('ReturnFrom', () => {
  const TestScope = scope('test/ReturnFrom')

  it('returns early from the matching scope with a value', () => {
    const result = fx(function* () {
      yield* returnFrom(TestScope, 'early')
      return 'late'
    }).pipe(
      withScope(TestScope),
      run
    )

    assert.equal(result, 'early')
  })

  it('does not run code after returnFrom', () => {
    let ran = false

    const result = fx(function* () {
      yield* returnFrom(TestScope, 'early')
      ran = true
      return 'late'
    }).pipe(
      withScope(TestScope),
      run
    )

    assert.equal(result, 'early')
    assert.equal(ran, false)
  })

  it('propagates returnFrom for non-matching scopes', () => {
    const OtherScope = scope('test/ReturnFrom/other')
    const f = fx(function* () {
      yield* returnFrom(OtherScope, 'other')
      return 'late'
    }).pipe(withScope(TestScope))

    const next = f[Symbol.iterator]().next()

    assert.equal(ReturnFrom.is(next.value), true)
    const effect = next.value as ReturnFrom<typeof OtherScope, 'other'>
    assert.equal(effect.scope, OtherScope)
    assert.equal(effect.arg, 'other')
  })

  it('only catches the nearest matching scope name', () => {
    const OtherScope = scope('test/ReturnFrom/other')

    const result = fx(function* () {
      return yield* fx(function* () {
        yield* returnFrom(TestScope, 'inner')
        return 'late'
      }).pipe(withScope(OtherScope))
    }).pipe(
      withScope(TestScope),
      run
    )

    assert.equal(result, 'inner')
  })
})
