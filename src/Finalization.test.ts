import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { abort, Abort, orReturn } from './Abort.js'
import { Fail, fail, returnFail } from './Fail.js'
import { fx, ok, run } from './Fx.js'
import { andFinally, andFinallyExit, managed, using, usingExit, usingManaged } from './Finalization.js'
import { returnFrom } from './ReturnFrom.js'
import { scope, type Exit } from './Scope.js'

describe('Finalization', () => {
  const TestScope = 'test/Finalization' as const
  it('releases finalizers in reverse registration order after success', () => {
    const released = [] as string[]

    const result = run(fx(function* () {
      yield* andFinally(TestScope, record(released, 'A'))
      yield* andFinally(TestScope, record(released, 'B'))
      yield* andFinally(TestScope, record(released, 'C'))
      return 'done'
    }).pipe(scope(TestScope), returnFail))

    assert.equal(result, 'done')
    assert.deepEqual(released, ['C', 'B', 'A'])
  })

  it('releases finalizers in reverse registration order after failure', () => {
    const released = [] as string[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* andFinally(TestScope, record(released, 'A'))
      yield* andFinally(TestScope, record(released, 'B'))
      yield* andFinally(TestScope, record(released, 'C'))
      yield* fail(programFailure)
    }).pipe(scope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, programFailure)
    assert.deepEqual(released, ['C', 'B', 'A'])
  })

  it('aggregates cleanup failures in release order', () => {
    const released = [] as string[]
    const aFailure = new Error('A release failed')
    const cFailure = new Error('C release failed')

    const result = run(fx(function* () {
      yield* andFinally(TestScope, record(released, 'A', aFailure))
      yield* andFinally(TestScope, record(released, 'B'))
      yield* andFinally(TestScope, record(released, 'C', cFailure))
      return 'done'
    }).pipe(scope(TestScope), returnFail))

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

    const result = run(fx(function* () {
      yield* andFinally(TestScope, record(released, 'A', aFailure))
      yield* andFinally(TestScope, record(released, 'B'))
      yield* andFinally(TestScope, record(released, 'C', cFailure))
      yield* fail(programFailure)
    }).pipe(scope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.deepEqual(result.arg.errors, [programFailure, cFailure, aFailure])
    assert.deepEqual(released, ['C', 'B', 'A'])
  })

  it('provides a success exit to exit-aware finalizers', () => {
    const exits = [] as Exit[]

    const result = run(fx(function* () {
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      return 'done'
    }).pipe(scope(TestScope), returnFail))

    assert.equal(result, 'done')
    assert.deepEqual(exits, [{ type: 'success', value: 'done' }])
  })

  it('provides a failure exit with the original Fail to exit-aware finalizers', () => {
    const exits = [] as Exit[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* fail(programFailure)
    }).pipe(scope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, programFailure)
    assert.equal(exits.length, 1)
    const [exit] = exits
    assert.equal(exit.type, 'failure')
    if (exit.type === 'failure') assert.equal(exit.failure.arg, programFailure)
  })

  it('runs multiple exit-aware finalizers in reverse registration order with the same exit', () => {
    const released = [] as string[]
    const exits = [] as Exit[]

    const result = run(fx(function* () {
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        released.push('A')
        exits.push(exit)
      }))
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        released.push('B')
        exits.push(exit)
      }))
      return 'done'
    }).pipe(scope(TestScope), returnFail))

    assert.equal(result, 'done')
    assert.deepEqual(released, ['B', 'A'])
    assert.equal(exits.length, 2)
    assert.equal(exits[0], exits[1])
    assert.deepEqual(exits[0], { type: 'success', value: 'done' })
  })

  it('using returns the initialized value and registers cleanup', () => {
    const released = [] as string[]

    const result = run(fx(function* () {
      return yield* using(TestScope, ok('resource'),
        resource => record(released, resource)
      )
    }).pipe(scope(TestScope), returnFail))

    assert.equal(result, 'resource')
    assert.deepEqual(released, ['resource'])
  })

  it('using does not register cleanup when initialization fails', () => {
    const released = [] as string[]
    const initFailure = new Error('init failed')

    const result = run(fx(function* () {
      return yield* using(TestScope, fail(initFailure),
        resource => record(released, String(resource))
      )
    }).pipe(scope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, initFailure)
    assert.deepEqual(released, [])
  })

  it('using runs cleanup when later work fails', () => {
    const released = [] as string[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* using(TestScope, 
        ok('resource'),
        resource => record(released, resource)
      )
      yield* fail(programFailure)
    }).pipe(scope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, programFailure)
    assert.deepEqual(released, ['resource'])
  })

  it('usingExit provides the resource and success exit', () => {
    const released = [] as string[]
    const exits = [] as Exit[]

    const result = run(fx(function* () {
      return yield* usingExit(TestScope, ok('resource'),
        (resource, exit) => fx(function* () {
          released.push(resource)
          exits.push(exit)
        })
      )
    }).pipe(scope(TestScope), returnFail))

    assert.equal(result, 'resource')
    assert.deepEqual(released, ['resource'])
    assert.deepEqual(exits, [{ type: 'success', value: 'resource' }])
  })

  it('usingExit provides the resource and failure exit', () => {
    const released = [] as string[]
    const exits = [] as Exit[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* usingExit(TestScope, 
        ok('resource'),
        (resource, exit) => fx(function* () {
          released.push(resource)
          exits.push(exit)
        })
      )
      yield* fail(programFailure)
    }).pipe(scope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, programFailure)
    assert.deepEqual(released, ['resource'])
    assert.equal(exits.length, 1)
    const [exit] = exits
    assert.equal(exit.type, 'failure')
    if (exit.type === 'failure') assert.equal(exit.failure.arg, programFailure)
  })

  it('usingExit release failure participates in cleanup aggregation', () => {
    const programFailure = new Error('program failed')
    const releaseFailure = new Error('release failed')

    const result = run(fx(function* () {
      yield* usingExit(TestScope, 
        ok('resource'),
        () => fail(releaseFailure)
      )
      yield* fail(programFailure)
    }).pipe(scope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.deepEqual(result.arg.errors, [programFailure, releaseFailure])
  })

  it('managed constructs a managed value with an inferred exit finalizer', () => {
    const exits = [] as string[]
    const m = managed('resource', exit => fx(function* () {
      exits.push(exit.type)
    }))

    assert.equal(m.value, 'resource')
    run(m.finalizer({ type: 'success', value: undefined }))
    assert.deepEqual(exits, ['success'])
  })

  it('usingManaged returns the managed value and registers its finalizer', () => {
    const released = [] as string[]

    const result = run(fx(function* () {
      return yield* usingManaged(TestScope, ok(managed(
        'resource',
        () => record(released, 'resource')
      )))
    }).pipe(scope(TestScope), returnFail))

    assert.equal(result, 'resource')
    assert.deepEqual(released, ['resource'])
  })

  it('usingManaged does not register cleanup when initialization fails', () => {
    const released = [] as string[]
    const initFailure = new Error('init failed')

    const result = run(fx(function* () {
      return yield* usingManaged(TestScope, fail(initFailure))
    }).pipe(scope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, initFailure)
    assert.deepEqual(released, [])
  })

  it('usingManaged finalizer receives the scope exit', () => {
    const exits = [] as Exit[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* usingManaged(TestScope, ok(managed(
        'resource',
        exit => fx(function* () {
          exits.push(exit)
        })
      )))
      yield* fail(programFailure)
    }).pipe(scope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, programFailure)
    assert.equal(exits.length, 1)
    const [exit] = exits
    assert.equal(exit.type, 'failure')
    if (exit.type === 'failure') assert.equal(exit.failure.arg, programFailure)
  })

  it('runs scoped finalizers after returnFrom', () => {
    const released = [] as string[]

    const result = run(fx(function* () {
      yield* andFinally(TestScope, record(released, 'A'))
      yield* andFinally(TestScope, record(released, 'B'))
      yield* returnFrom(TestScope, 'returned')
    }).pipe(scope(TestScope), returnFail))

    assert.equal(result, 'returned')
    assert.deepEqual(released, ['B', 'A'])
  })

  it('provides returnFrom exit to exit-aware finalizers', () => {
    const exits = [] as Exit[]

    const result = run(fx(function* () {
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* returnFrom(TestScope, 'returned')
    }).pipe(scope(TestScope), returnFail))

    assert.equal(result, 'returned')
    assert.deepEqual(exits, [{
      type: 'returnFrom',
      scope: TestScope,
      value: 'returned'
    }])
  })

  it('runs scoped finalizers after handled abort', () => {
    const released = [] as string[]

    const result = run(fx(function* () {
      yield* andFinally(TestScope, record(released, 'A'))
      yield* andFinally(TestScope, record(released, 'B'))
      yield* abort(TestScope)
    }).pipe(scope(TestScope), orReturn(TestScope, 'aborted'), returnFail))

    assert.equal(result, 'aborted')
    assert.deepEqual(released, ['B', 'A'])
  })

  it('provides abort exit to exit-aware finalizers before re-emitting unhandled abort', () => {
    const exits = [] as Exit[]

    const f = fx(function* () {
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* abort(TestScope)
    }).pipe(scope(TestScope))

    const next = f[Symbol.iterator]().next()

    assert.equal(Abort.is(next.value), true)
    assert.deepEqual(exits, [{ type: 'abort', scope: TestScope }])
  })

  it('does not run finalizers from a different scope', () => {
    const OtherScope = 'test/Finalization/other' as const
    const released = [] as string[]

    const f = fx(function* () {
      yield* andFinally(OtherScope, record(released, 'other'))
      return 'done'
    }).pipe(scope(TestScope))

    const next = f[Symbol.iterator]().next()

    assert.equal(next.done, false)
    assert.deepEqual(released, [])
  })
})

const record = (released: string[], label: string, failure?: unknown) => fx(function* () {
  released.push(label)
  if (failure !== undefined) yield* fail(failure)
})
