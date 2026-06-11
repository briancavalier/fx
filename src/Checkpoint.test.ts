import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Checkpoint, checkpoint } from './Checkpoint.js'
import { ok, type Fx } from './Fx.js'
import { scope } from './Scope.js'

describe('Checkpoint', () => {
  it('emits a visible checkpoint request until handled', () => {
    const PlainScope = scope('test/Checkpoint/Plain')
    const program = ok('value').pipe(checkpoint(PlainScope))
    type Effects = EffectOf<typeof program>
    const checkpointIsVisible: Extract<Effects, Checkpoint<typeof PlainScope, any, any>> extends never ? false : true = true
    const next = program[Symbol.iterator]().next()

    assert.equal(checkpointIsVisible, true)
    assert.equal(next.done, false)
    assert.equal(Checkpoint.is(next.value), true)
  })
})

type EffectOf<F> = F extends Fx<infer E, any> ? E : never
