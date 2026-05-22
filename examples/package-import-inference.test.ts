import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect, fx, ScopedEffect, type Fx } from '@briancavalier/fx'
import { scope, type AnyScope } from '@briancavalier/fx/scope'

type EffectOf<T> = T extends Fx<infer E, unknown> ? E : never
type IsAny<T> = 0 extends 1 & T ? true : false

describe('package import inference', () => {
  it('preserves Effect instance types through package declarations', () => {
    class AskName extends Effect('test/package-import-inference/AskName')<string, string> { }

    const program = fx(function* () {
      return yield* new AskName('name')
    })

    const effectIsAny: IsAny<EffectOf<typeof program>> = false
    const effectIsAskName: EffectOf<typeof program> extends AskName ? true : false = true

    // @ts-expect-error AskName remains visible until a handler removes it.
    const runnable: Fx<never, string> = program

    assert.equal(effectIsAny, false)
    assert.equal(effectIsAskName, true)
    void runnable
  })

  it('preserves ScopedEffect instance types through package declarations', () => {
    const Scope = scope('test/package-import-inference/ScopedAsk')
    class ScopedAsk<const S extends AnyScope> extends ScopedEffect('test/package-import-inference/ScopedAsk')<S, string, string> { }

    const program = fx(function* () {
      return yield* new ScopedAsk(Scope, 'name')
    })

    const effectIsAny: IsAny<EffectOf<typeof program>> = false
    const effectIsScopedAsk: EffectOf<typeof program> extends ScopedAsk<typeof Scope> ? true : false = true

    // @ts-expect-error ScopedAsk remains visible until a scoped handler removes it.
    const runnable: Fx<never, string> = program

    assert.equal(effectIsAny, false)
    assert.equal(effectIsScopedAsk, true)
    void runnable
  })
})
