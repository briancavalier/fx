import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { key, sameKey, type Key } from './Key.js'
import type { Yielding } from './YieldFrom.js'

describe('Key', () => {
  it('matches keys by singleton id', () => {
    const First = key<Yielding<number>>()('test/Key/same-id')
    const Second = key<Yielding<number>>()('test/Key/same-id')
    const Other = key<Yielding<number>>()('test/Key/other-id')

    assert.equal(sameKey(First, Second), true)
    assert.equal(sameKey(First, Other), false)
  })

  it('preserves exact singleton id types', () => {
    const Literal = key<Yielding<number>>()('test/Key/literal-id')
    const _: Key<'test/Key/literal-id'> & Yielding<number> = Literal

    const SymbolId = Symbol('test/Key/symbol-id')
    const SymbolKey = key<Yielding<number>>()(SymbolId)
    const __: Key<typeof SymbolId> & Yielding<number> = SymbolKey

    void _
    void __
  })

  it('rejects widened key ids', () => {
    const stringId: string = 'test/Key/string-id'
    const numberId: number = 1
    const symbolId: symbol = Symbol('test/Key/wide-symbol-id')

    // @ts-expect-error key ids must be exact singleton ids.
    key<Yielding<number>>()(stringId)
    // @ts-expect-error key ids must be exact singleton ids.
    key<Yielding<number>>()(numberId)
    // @ts-expect-error key ids must be exact singleton ids.
    key<Yielding<number>>()(symbolId)
  })

  it('rejects union key ids', () => {
    const unionId: 'test/Key/a' | 'test/Key/b' =
      Math.random() > 0.5 ? 'test/Key/a' : 'test/Key/b'

    // @ts-expect-error key ids must be one exact singleton id.
    key<Yielding<number>>()(unionId)
  })
})
