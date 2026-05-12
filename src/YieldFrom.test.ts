import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abort, orReturn } from './Abort.js'
import { fx, ok, run, type Fx } from './Fx.js'
import { returnFrom } from './ReturnFrom.js'
import { scope } from './Scope.js'
import { brand, collectFrom, handleYieldFrom, YieldFrom, yieldFrom } from './YieldFrom.js'
import type { Yielding } from './YieldFrom.js'

describe('YieldFrom', () => {
  const NumberScope = brand<Yielding<number>>()('test/YieldFrom/numbers')
  const ItemScope = brand<Yielding<'item'>>()('test/YieldFrom/item')
  const DecisionScope = brand<Yielding<string, boolean>>()('test/YieldFrom/decision')

  it('collects one-way yields from the matching scope', () => {
    const result = fx(function* () {
      yield* yieldFrom(NumberScope, 1)
      yield* yieldFrom(NumberScope, 2)
      return 'done'
    }).pipe(
      collectFrom(NumberScope),
      run
    )

    assert.deepEqual(result, ['done', [1, 2]])
  })

  it('preserves yield order and final result when collecting', () => {
    const result = fx(function* () {
      for (let i = 0; i < 4; ++i) yield* yieldFrom(NumberScope, i)
      return 4
    }).pipe(
      collectFrom(NumberScope),
      run
    )

    assert.deepEqual(result, [4, [0, 1, 2, 3]])
  })

  it('propagates yields from a different scope', () => {
    const OtherScope = brand<Yielding<'other'>>()('test/YieldFrom/other')

    const f = fx(function* () {
      yield* yieldFrom(OtherScope, 'other')
      return 'done'
    }).pipe(handleYieldFrom(NumberScope, () => ok(undefined)))

    const _: typeof f extends Fx<YieldFrom<typeof OtherScope>, string> ? true : false = true
    const next = f[Symbol.iterator]().next()

    assert.equal(YieldFrom.is(next.value), true)
    const effect = next.value as YieldFrom<typeof OtherScope>
    assert.deepEqual(effect.arg, { scope: OtherScope, value: 'other' })
  })

  it('handles nested named yield scopes independently', () => {
    const InnerScope = brand<Yielding<'inner'>>()('test/YieldFrom/inner')
    const outer = [] as number[]
    const inner = [] as string[]

    const result = fx(function* () {
      yield* yieldFrom(NumberScope, 2)
      yield* yieldFrom(InnerScope, 'inner')
      return 'done'
    }).pipe(
      handleYieldFrom(InnerScope, value => ok(void inner.push(value))),
      handleYieldFrom(NumberScope, value => ok(void outer.push(value))),
      run
    )

    assert.equal(result, 'done')
    assert.deepEqual(outer, [2])
    assert.deepEqual(inner, ['inner'])
  })

  it('narrows matching YieldFrom effects', () => {
    const f = fx(function* () {
      yield* yieldFrom(ItemScope, 'item')
      return true
    }).pipe(handleYieldFrom(ItemScope, () => ok(undefined)))

    const _: typeof f extends Fx<never, boolean> ? true : false = true

    assert.equal(f.pipe(run), true)
  })

  it('resumes with the branded input type', () => {
    const f = fx(function* () {
      const accepted = yield* yieldFrom(DecisionScope, 'item')
      const _: boolean = accepted
      return accepted ? 'accepted' : 'rejected'
    }).pipe(handleYieldFrom(DecisionScope, value => ok(value === 'item')))

    const _: typeof f extends Fx<never, 'accepted' | 'rejected'> ? true : false = true

    assert.equal(f.pipe(run), 'accepted')
  })

  it('requires yielded values to match the scope brand', () => {
    // @ts-expect-error NumberScope yields numbers
    const _ = yieldFrom(NumberScope, 'not a number')

    assert.equal(typeof _, 'object')
  })

  it('allows ReturnFrom from a yield handler', () => {
    const ReturnScope = 'test/YieldFrom/return' as const

    const result = fx(function* () {
      yield* yieldFrom(ItemScope, 'item')
      return 'late'
    }).pipe(
      handleYieldFrom(ItemScope, () => returnFrom(ReturnScope, 'early')),
      scope(ReturnScope),
      run
    )

    assert.equal(result, 'early')
  })

  it('allows Abort from a yield handler', () => {
    const AbortScope = 'test/YieldFrom/abort' as const

    const result = fx(function* () {
      yield* yieldFrom(ItemScope, 'item')
      return 'late'
    }).pipe(
      handleYieldFrom(ItemScope, () => abort(AbortScope)),
      scope(AbortScope),
      orReturn(AbortScope, 'aborted'),
      run
    )

    assert.equal(result, 'aborted')
  })
})
