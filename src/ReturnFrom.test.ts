import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, run } from './Fx.js'
import { ReturnFrom, returnFrom } from './ReturnFrom.js'
import { scope } from './Scope.js'

describe('ReturnFrom', () => {
  const TestScope = 'test/ReturnFrom' as const

  it('returns early from the matching scope with a value', () => {
    const result = fx(function* () {
      yield* returnFrom(TestScope, 'early')
      return 'late'
    }).pipe(
      scope(TestScope),
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
      scope(TestScope),
      run
    )

    assert.equal(result, 'early')
    assert.equal(ran, false)
  })

  it('propagates returnFrom for non-matching scopes', () => {
    const OtherScope = 'test/ReturnFrom/other' as const
    const f = fx(function* () {
      yield* returnFrom(OtherScope, 'other')
      return 'late'
    }).pipe(scope(TestScope))

    const next = f[Symbol.iterator]().next()

    assert.equal(ReturnFrom.is(next.value), true)
  })

  it('only catches the nearest matching scope name', () => {
    const OtherScope = 'test/ReturnFrom/other' as const

    const result = fx(function* () {
      return yield* fx(function* () {
        yield* returnFrom(TestScope, 'inner')
        return 'late'
      }).pipe(scope(OtherScope))
    }).pipe(
      scope(TestScope),
      run
    )

    assert.equal(result, 'inner')
  })
})
