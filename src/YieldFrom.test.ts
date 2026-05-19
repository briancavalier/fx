import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abort, orReturn } from './Abort.js'
import { fx, ok, run, type Fx } from './Fx.js'
import { GlobalScope } from './GlobalScope.js'
import { handleScoped } from './Handler.js'
import { returnFrom } from './ReturnFrom.js'
import { brand, scope } from './Scope.js'
import { collectFrom, YieldFrom, yieldFrom } from './YieldFrom.js'
import type { Yielding, YieldInput, YieldOutput } from './YieldFrom.js'

describe('YieldFrom', () => {
  const NumberScope = brand<Yielding<number>>()('test/YieldFrom/numbers')
  const ItemScope = brand<Yielding<'item'>>()('test/YieldFrom/item')
  const DecisionScope = brand<Yielding<string, boolean>>()('test/YieldFrom/decision')

  it('coalesces global scope yield outputs by union and inputs by intersection', () => {
    type AskUser = Yielding<
      { readonly type: 'askUser'; readonly id: string },
      { readonly askUser: { readonly name: string } }
    >
    type AskConfig = Yielding<
      { readonly type: 'askConfig'; readonly key: string },
      { readonly askConfig: { readonly value: string } }
    >
    type GlobalYieldScope = typeof GlobalScope & AskUser & AskConfig

    const out = null as unknown as YieldOutput<GlobalYieldScope>
    const _: { readonly type: 'askUser'; readonly id: string } | { readonly type: 'askConfig'; readonly key: string } = out
    const input = null as unknown as YieldInput<GlobalYieldScope>
    const __: {
      readonly askUser: { readonly name: string }
    } & {
      readonly askConfig: { readonly value: string }
    } = input

    assert.equal(GlobalScope, 'fx/Scope/Global')
  })

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
    }).pipe(handleScoped(YieldFrom<typeof NumberScope>, NumberScope, () => ok(undefined)))

    const _: typeof f extends Fx<YieldFrom<typeof OtherScope>, string> ? true : false = true
    const next = f[Symbol.iterator]().next()

    assert.equal(YieldFrom.is(next.value), true)
    const effect = next.value as YieldFrom<typeof OtherScope>
    assert.equal(effect.scope, OtherScope)
    assert.equal(effect.arg, 'other')
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
      handleScoped(YieldFrom<typeof InnerScope>, InnerScope, effect => ok(void inner.push(effect.arg))),
      handleScoped(YieldFrom<typeof NumberScope>, NumberScope, effect => ok(void outer.push(effect.arg))),
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
    }).pipe(handleScoped(YieldFrom<typeof ItemScope>, ItemScope, () => ok(undefined)))

    const _: typeof f extends Fx<never, boolean> ? true : false = true

    assert.equal(f.pipe(run), true)
  })

  it('resumes with the branded input type', () => {
    const f = fx(function* () {
      const accepted = yield* yieldFrom(DecisionScope, 'item')
      const _: boolean = accepted
      return accepted ? 'accepted' : 'rejected'
    }).pipe(handleScoped(YieldFrom<typeof DecisionScope>, DecisionScope, effect => ok(effect.arg === 'item')))

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
      handleScoped(YieldFrom<typeof ItemScope>, ItemScope, () => returnFrom(ReturnScope, 'early')),
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
      handleScoped(YieldFrom<typeof ItemScope>, ItemScope, () => abort(AbortScope)),
      scope(AbortScope),
      orReturn(AbortScope, 'aborted'),
      run
    )

    assert.equal(result, 'aborted')
  })
})
