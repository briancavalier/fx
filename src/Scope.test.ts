import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Fail, fail, returnFail } from './Fail.js'
import { fx, run } from './Fx.js'
import { finalize, scope } from './Scope.js'

describe('Scope', () => {
  it('releases finalizers in reverse registration order after success', () => {
    const released = [] as string[]

    const result = run(scope(fx(function* () {
      yield* finalize(record(released, 'A'))
      yield* finalize(record(released, 'B'))
      yield* finalize(record(released, 'C'))
      return 'done'
    })).pipe(returnFail))

    assert.equal(result, 'done')
    assert.deepEqual(released, ['C', 'B', 'A'])
  })

  it('releases finalizers in reverse registration order after failure', () => {
    const released = [] as string[]
    const programFailure = new Error('program failed')

    const result = run(scope(fx(function* () {
      yield* finalize(record(released, 'A'))
      yield* finalize(record(released, 'B'))
      yield* finalize(record(released, 'C'))
      yield* fail(programFailure)
    })).pipe(returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, programFailure)
    assert.deepEqual(released, ['C', 'B', 'A'])
  })

  it('aggregates cleanup failures in release order', () => {
    const released = [] as string[]
    const aFailure = new Error('A release failed')
    const cFailure = new Error('C release failed')

    const result = run(scope(fx(function* () {
      yield* finalize(record(released, 'A', aFailure))
      yield* finalize(record(released, 'B'))
      yield* finalize(record(released, 'C', cFailure))
      return 'done'
    })).pipe(returnFail))

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.deepEqual(result.arg.errors, [cFailure, aFailure])
    assert.deepEqual(released, ['C', 'B', 'A'])
  })

  it('keeps program failure first before cleanup failures in release order', () => {
    const released = [] as string[]
    const programFailure = new Error('program failed')
    const aFailure = new Error('A release failed')
    const cFailure = new Error('C release failed')

    const result = run(scope(fx(function* () {
      yield* finalize(record(released, 'A', aFailure))
      yield* finalize(record(released, 'B'))
      yield* finalize(record(released, 'C', cFailure))
      yield* fail(programFailure)
    })).pipe(returnFail))

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.deepEqual(result.arg.errors, [programFailure, cFailure, aFailure])
    assert.deepEqual(released, ['C', 'B', 'A'])
  })
})

const record = (released: string[], label: string, failure?: unknown) => fx(function* () {
  released.push(label)
  if (failure !== undefined) yield* fail(failure)
})
