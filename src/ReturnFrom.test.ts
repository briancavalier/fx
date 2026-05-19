import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fx, run } from './Fx.js'
import { ReturnFrom, returnFrom } from './ReturnFrom.js'
import { scope, GlobalScope } from './Scope.js'

describe('ReturnFrom', () => {
  const TestScope = 'test/ReturnFrom' as const

  it('defaults to returning early from the global scope', () => {
    const result = fx(function* () {
      yield* returnFrom('early')
      return 'late'
    }).pipe(
      scope(),
      run
    )

    assert.equal(result, 'early')
  })

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

  it('propagates global returnFrom through an explicit scope', () => {
    const f = fx(function* () {
      yield* returnFrom('global')
      return 'late'
    }).pipe(scope(TestScope))

    const next = f[Symbol.iterator]().next()

    assert.equal(ReturnFrom.is(next.value), true)
    const effect = next.value as ReturnFrom<typeof GlobalScope, 'global'>
    assert.equal(effect.scope, GlobalScope)
    assert.equal(effect.arg, 'global')
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
    const effect = next.value as ReturnFrom<typeof OtherScope, 'other'>
    assert.equal(effect.scope, OtherScope)
    assert.equal(effect.arg, 'other')
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
