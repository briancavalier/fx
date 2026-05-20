import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { abort, Abort, orReturn } from './Abort.js'
import { Fail, fail, returnFail } from './Fail.js'
import { fx, ok, run, type Fx } from './Fx.js'
import { andFinally, andFinallyExit, managed, using, usingManaged, type Finally, type Managed } from './Finalization.js'
import type { Interrupt } from './Interrupt.js'
import { returnFrom } from './ReturnFrom.js'
import { brand, scope, type Exit } from './Scope.js'
import { collectFrom, YieldFrom, yieldFrom, type Yielding } from './YieldFrom.js'

describe('Finalization', () => {
  const TestScope = 'test/Finalization' as const
  const CleanupEvents = brand<Yielding<'cleanup'>>()('test/Finalization/cleanup')

  it('preserves finalizer effects in constructor types', () => {
    const releaseFailure = new Error('release failed')
    const finalizer = andFinally(TestScope, yieldFrom(CleanupEvents, 'cleanup'))
    const exitFinalizer = andFinallyExit(TestScope, () => fail(releaseFailure))

    const _: typeof finalizer extends Fx<Finally<typeof TestScope, YieldFrom<typeof CleanupEvents>>, void> ? true : false = true
    const __: typeof exitFinalizer extends Fx<Finally<typeof TestScope, Fail<Error>>, void> ? true : false = true

    assert.equal(typeof _, 'boolean')
    assert.equal(typeof __, 'boolean')
  })

  it('preserves finalizer effects in resource helper types', () => {
    const releaseFailure = new Error('release failed')
    const resource = using(TestScope, ok('resource'), () => yieldFrom(CleanupEvents, 'cleanup'))
    const exitResource = using(TestScope, ok('resource'), () => fail(releaseFailure))
    const managedResource = usingManaged(TestScope, ok(managed(
      'resource',
      () => yieldFrom(CleanupEvents, 'cleanup')
    )))

    const _: typeof resource extends Fx<Finally<typeof TestScope, YieldFrom<typeof CleanupEvents>> | Interrupt, 'resource'> ? true : false = true
    const __: typeof exitResource extends Fx<Finally<typeof TestScope, Fail<Error>> | Interrupt, 'resource'> ? true : false = true
    const ___: typeof managedResource extends Fx<Finally<typeof TestScope, YieldFrom<typeof CleanupEvents>> | Interrupt, 'resource'> ? true : false = true

    assert.equal(typeof _, 'boolean')
    assert.equal(typeof __, 'boolean')
    assert.equal(typeof ___, 'boolean')
  })

  it('exposes non-failure finalizer effects after scope', () => {
    const scoped = fx(function* () {
      yield* andFinally(TestScope, yieldFrom(CleanupEvents, 'cleanup'))
      return 'done'
    }).pipe(scope(TestScope))

    const _: typeof scoped extends Fx<YieldFrom<typeof CleanupEvents> | Fail<AggregateError>, 'done'> ? true : false = true

    const result = run(scoped.pipe(
      collectFrom(CleanupEvents),
      returnFail
    ))

    assert.equal(typeof _, 'boolean')
    assert.deepEqual(result, ['done', ['cleanup']])
  })

  it('exposes cleanup failures as AggregateError after scope', () => {
    const releaseFailure = new Error('release failed')
    const scoped = fx(function* () {
      yield* andFinally(TestScope, fail(releaseFailure))
      return 'done'
    }).pipe(scope(TestScope))

    const _: typeof scoped extends Fx<Fail<AggregateError>, 'done'> ? true : false = true

    const result = run(scoped.pipe(returnFail))

    assert.equal(typeof _, 'boolean')
    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.deepEqual(result.arg.errors, [releaseFailure])
  })

  it('leaves finalizers from a different scope visible after scope', () => {
    const OtherScope = 'test/Finalization/other' as const
    const scoped = fx(function* () {
      yield* andFinally(OtherScope, yieldFrom(CleanupEvents, 'cleanup'))
      return 'done'
    }).pipe(scope(TestScope))

    const _: typeof scoped extends Fx<Finally<typeof OtherScope, YieldFrom<typeof CleanupEvents>>, 'done'> ? true : false = true
    const next = scoped[Symbol.iterator]().next()

    assert.equal(typeof _, 'boolean')
    assert.equal(next.done, false)
    assert.equal((next.value as { readonly scope?: unknown }).scope, OtherScope)
  })

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

  it('using delays finalizer construction until scope exit', () => {
    const events = [] as string[]

    const result = run(fx(function* () {
      const resource = yield* using(TestScope, ok('resource'),
        resource => {
          events.push(`release ${resource}`)
          return record(events, 'cleanup')
        }
      )
      events.push(`use ${resource}`)
      return resource
    }).pipe(scope(TestScope), returnFail))

    assert.equal(result, 'resource')
    assert.deepEqual(events, ['use resource', 'release resource', 'cleanup'])
  })

  it('using provides the resource and success exit', () => {
    const released = [] as string[]
    const exits = [] as Exit[]

    const result = run(fx(function* () {
      return yield* using(TestScope, ok('resource'),
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

  it('using provides the resource and failure exit', () => {
    const released = [] as string[]
    const exits = [] as Exit[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* using(TestScope,
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

  it('using release failure participates in cleanup aggregation', () => {
    const programFailure = new Error('program failed')
    const releaseFailure = new Error('release failed')

    const result = run(fx(function* () {
      yield* using(TestScope,
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
      return yield* usingManaged(TestScope, fail(initFailure) as Fx<Fail<Error>, Managed<string>>)
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
