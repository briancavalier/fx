import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assertPromise } from './Async.js'
import { fork, withUnboundedConcurrency } from './Concurrent.js'
import { abort, Abort, orReturn } from './Abort.js'
import { Fail, fail, returnFail } from './Fail.js'
import { fx, ok, run, runPromise, type Fx } from './Fx.js'
import { andFinallyIn, managed, usingIn, usingManagedIn, type Finally, type Managed } from './Finalization.js'
import type { Interrupt } from './Interrupt.js'
import { key } from './Key.js'
import { returnFrom } from './ReturnFrom.js'
import { scope, inScope, withScope, type AnyLifetimeScope, type Control, type Exit } from './Scope.js'
import { collectFrom, YieldFrom, yieldFrom, type Yielding } from './YieldFrom.js'

describe('Finalization', () => {
  const TestScope = scope<Control>()('test/Finalization')
  const CleanupEvents = key<Yielding<'cleanup'>>()('test/Finalization/cleanup')

  it('preserves finalizer effects in constructor types', () => {
    const releaseFailure = new Error('release failed')
    const finalizer = andFinallyIn(TestScope, yieldFrom(CleanupEvents, 'cleanup'))
    const exitFinalizer = andFinallyIn(TestScope, () => fail(releaseFailure))

    const _: typeof finalizer extends Fx<Finally<typeof TestScope, YieldFrom<typeof CleanupEvents>>, void> ? true : false = true
    const __: typeof exitFinalizer extends Fx<Finally<typeof TestScope, Fail<Error>>, void> ? true : false = true

    assert.equal(typeof _, 'boolean')
    assert.equal(typeof __, 'boolean')
  })

  it('preserves finalizer effects in resource helper types', () => {
    const releaseFailure = new Error('release failed')
    const resource = usingIn(TestScope, ok('resource'), () => yieldFrom(CleanupEvents, 'cleanup'))
    const exitResource = usingIn(TestScope, ok('resource'), () => fail(releaseFailure))
    const managedResource = usingManagedIn(TestScope, ok(managed(
      'resource',
      () => yieldFrom(CleanupEvents, 'cleanup')
    )))

    const _: typeof resource extends Fx<YieldFrom<typeof CleanupEvents> | Finally<typeof TestScope, YieldFrom<typeof CleanupEvents>> | Interrupt, 'resource'> ? true : false = true
    const __: typeof exitResource extends Fx<Fail<Error> | Finally<typeof TestScope, Fail<Error>> | Interrupt, 'resource'> ? true : false = true
    const ___: typeof managedResource extends Fx<YieldFrom<typeof CleanupEvents> | Finally<typeof TestScope, YieldFrom<typeof CleanupEvents>> | Interrupt, 'resource'> ? true : false = true

    assert.equal(typeof _, 'boolean')
    assert.equal(typeof __, 'boolean')
    assert.equal(typeof ___, 'boolean')
  })

  it('exposes non-failure finalizer effects after scope', () => {
    const scoped = fx(function* () {
      yield* andFinallyIn(TestScope, yieldFrom(CleanupEvents, 'cleanup'))
      return 'done'
    }).pipe(inScope(TestScope))

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
      yield* andFinallyIn(TestScope, fail(releaseFailure))
      return 'done'
    }).pipe(inScope(TestScope))

    const _: typeof scoped extends Fx<Fail<AggregateError>, 'done'> ? true : false = true

    const result = run(scoped.pipe(returnFail))

    assert.equal(typeof _, 'boolean')
    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.deepEqual(result.arg.errors, [releaseFailure])
  })

  it('leaves finalizers from a different scope visible after scope', () => {
    const OtherScope = scope<Control>()('test/Finalization/other')
    const scoped = fx(function* () {
      yield* andFinallyIn(OtherScope, yieldFrom(CleanupEvents, 'cleanup'))
      return 'done'
    }).pipe(inScope(TestScope))

    const _: typeof scoped extends Fx<Finally<typeof OtherScope, YieldFrom<typeof CleanupEvents>> | Fail<AggregateError>, 'done'> ? true : false = true
    const next = scoped[Symbol.iterator]().next()

    assert.equal(typeof _, 'boolean')
    assert.equal(next.done, false)
    assert.equal((next.value as { readonly scope?: unknown }).scope, OtherScope)
  })

  it('releases finalizers in reverse registration order after success', () => {
    const released = [] as string[]

    const result = run(fx(function* () {
      yield* andFinallyIn(TestScope, record(released, 'A'))
      yield* andFinallyIn(TestScope, record(released, 'B'))
      yield* andFinallyIn(TestScope, record(released, 'C'))
      return 'done'
    }).pipe(inScope(TestScope), returnFail))

    assert.equal(result, 'done')
    assert.deepEqual(released, ['C', 'B', 'A'])
  })

  it('releases finalizers in reverse registration order after failure', () => {
    const released = [] as string[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* andFinallyIn(TestScope, record(released, 'A'))
      yield* andFinallyIn(TestScope, record(released, 'B'))
      yield* andFinallyIn(TestScope, record(released, 'C'))
      yield* fail(programFailure)
    }).pipe(inScope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, programFailure)
    assert.deepEqual(released, ['C', 'B', 'A'])
  })

  it('aggregates cleanup failures in release order', () => {
    const released = [] as string[]
    const aFailure = new Error('A release failed')
    const cFailure = new Error('C release failed')

    const result = run(fx(function* () {
      yield* andFinallyIn(TestScope, record(released, 'A', aFailure))
      yield* andFinallyIn(TestScope, record(released, 'B'))
      yield* andFinallyIn(TestScope, record(released, 'C', cFailure))
      return 'done'
    }).pipe(inScope(TestScope), returnFail))

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
      yield* andFinallyIn(TestScope, record(released, 'A', aFailure))
      yield* andFinallyIn(TestScope, record(released, 'B'))
      yield* andFinallyIn(TestScope, record(released, 'C', cFailure))
      yield* fail(programFailure)
    }).pipe(inScope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof AggregateError)
    assert.deepEqual(result.arg.errors, [programFailure, cFailure, aFailure])
    assert.deepEqual(released, ['C', 'B', 'A'])
  })

  it('provides a success exit to exit-aware finalizers', () => {
    const exits = [] as Exit[]

    const result = run(fx(function* () {
      yield* andFinallyIn(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      return 'done'
    }).pipe(inScope(TestScope), returnFail))

    assert.equal(result, 'done')
    assert.deepEqual(exits, [{ type: 'success', value: 'done' }])
  })

  it('provides a failure exit with the original Fail to exit-aware finalizers', () => {
    const exits = [] as Exit[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* andFinallyIn(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* fail(programFailure)
    }).pipe(inScope(TestScope), returnFail))

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
      yield* andFinallyIn(TestScope, exit => fx(function* () {
        released.push('A')
        exits.push(exit)
      }))
      yield* andFinallyIn(TestScope, exit => fx(function* () {
        released.push('B')
        exits.push(exit)
      }))
      return 'done'
    }).pipe(inScope(TestScope), returnFail))

    assert.equal(result, 'done')
    assert.deepEqual(released, ['B', 'A'])
    assert.equal(exits.length, 2)
    assert.equal(exits[0], exits[1])
    assert.deepEqual(exits[0], { type: 'success', value: 'done' })
  })

  it('usingIn returns the initialized value and registers cleanup', () => {
    const released = [] as string[]

    const result = run(fx(function* () {
      return yield* usingIn(TestScope, ok('resource'),
        resource => record(released, resource)
      )
    }).pipe(inScope(TestScope), returnFail))

    assert.equal(result, 'resource')
    assert.deepEqual(released, ['resource'])
  })

  it('usingIn rejects closed scope handles before initialization', () => {
    let leaked: AnyLifetimeScope | undefined
    let acquired = false

    run(withScope(scope => fx(function* () {
      leaked = scope
    })))

    assert.throws(
      () => drainSync(usingIn(leaked!, fx(function* () {
        acquired = true
        return 'resource'
      }), () => ok(undefined))),
      /used after its scope exited/
    )
    assert.equal(acquired, false)
  })

  it('usingIn releases resources acquired after lexical scope exit', async () => {
    const released = [] as string[]
    const exits = [] as Exit[]
    let resolve!: (value: string) => void

    const task = await withScope(scope => fx(function* () {
      const task = yield* fork(usingIn(
        scope,
        assertPromise<string>(() => new Promise(r => {
          resolve = r
        })),
        (resource, exit) => fx(function* () {
          released.push(resource)
          exits.push(exit)
        })
      ).pipe(inScope(scope)))
      return yield* assertPromise(() => eventually(() => resolve !== undefined).then(() => task))
    })).pipe(withUnboundedConcurrency).pipe(runPromise)

    resolve('resource')

    await assert.rejects(task.promise, hasStaleScopeCause)
    assert.deepEqual(released, ['resource'])
    assert.equal(exits.length, 1)
    assert.equal(exits[0]?.type, 'interrupted')
    assert.match(String(exits[0]?.reason), /used after its scope exited/)
  })

  it('usingIn does not register cleanup when initialization fails', () => {
    const released = [] as string[]
    const initFailure = new Error('init failed')

    const result = run(fx(function* () {
      return yield* usingIn(TestScope, fail(initFailure),
        resource => record(released, String(resource))
      )
    }).pipe(inScope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, initFailure)
    assert.deepEqual(released, [])
  })

  it('usingIn runs cleanup when later work fails', () => {
    const released = [] as string[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* usingIn(TestScope,
        ok('resource'),
        resource => record(released, resource)
      )
      yield* fail(programFailure)
    }).pipe(inScope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, programFailure)
    assert.deepEqual(released, ['resource'])
  })

  it('usingIn delays finalizer construction until scope exit', () => {
    const events = [] as string[]

    const result = run(fx(function* () {
      const resource = yield* usingIn(TestScope, ok('resource'),
        resource => {
          events.push(`release ${resource}`)
          return record(events, 'cleanup')
        }
      )
      events.push(`use ${resource}`)
      return resource
    }).pipe(inScope(TestScope), returnFail))

    assert.equal(result, 'resource')
    assert.deepEqual(events, ['use resource', 'release resource', 'cleanup'])
  })

  it('usingIn provides the resource and success exit', () => {
    const released = [] as string[]
    const exits = [] as Exit[]

    const result = run(fx(function* () {
      return yield* usingIn(TestScope, ok('resource'),
        (resource, exit) => fx(function* () {
          released.push(resource)
          exits.push(exit)
        })
      )
    }).pipe(inScope(TestScope), returnFail))

    assert.equal(result, 'resource')
    assert.deepEqual(released, ['resource'])
    assert.deepEqual(exits, [{ type: 'success', value: 'resource' }])
  })

  it('usingIn provides the resource and failure exit', () => {
    const released = [] as string[]
    const exits = [] as Exit[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* usingIn(TestScope,
        ok('resource'),
        (resource, exit) => fx(function* () {
          released.push(resource)
          exits.push(exit)
        })
      )
      yield* fail(programFailure)
    }).pipe(inScope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, programFailure)
    assert.deepEqual(released, ['resource'])
    assert.equal(exits.length, 1)
    const [exit] = exits
    assert.equal(exit.type, 'failure')
    if (exit.type === 'failure') assert.equal(exit.failure.arg, programFailure)
  })

  it('usingIn release failure participates in cleanup aggregation', () => {
    const programFailure = new Error('program failed')
    const releaseFailure = new Error('release failed')

    const result = run(fx(function* () {
      yield* usingIn(TestScope,
        ok('resource'),
        () => fail(releaseFailure)
      )
      yield* fail(programFailure)
    }).pipe(inScope(TestScope), returnFail))

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

  it('usingManagedIn returns the managed value and registers its finalizer', () => {
    const released = [] as string[]

    const result = run(fx(function* () {
      return yield* usingManagedIn(TestScope, ok(managed(
        'resource',
        () => record(released, 'resource')
      )))
    }).pipe(inScope(TestScope), returnFail))

    assert.equal(result, 'resource')
    assert.deepEqual(released, ['resource'])
  })

  it('usingManagedIn rejects closed scope handles before initialization', () => {
    let leaked: AnyLifetimeScope | undefined
    let acquired = false

    run(withScope(scope => fx(function* () {
      leaked = scope
    })))

    assert.throws(
      () => drainSync(usingManagedIn(leaked!, fx(function* () {
        acquired = true
        return managed('resource', () => ok(undefined))
      }))),
      /used after its scope exited/
    )
    assert.equal(acquired, false)
  })

  it('usingManagedIn releases resources acquired after lexical scope exit', async () => {
    const released = [] as string[]
    const exits = [] as Exit[]
    let resolve!: (value: Managed<string>) => void

    const task = await withScope(scope => fx(function* () {
      const task = yield* fork(usingManagedIn(
        scope,
        assertPromise<Managed<string>>(() => new Promise(r => {
          resolve = r
        }))
      ).pipe(inScope(scope)))
      return yield* assertPromise(() => eventually(() => resolve !== undefined).then(() => task))
    })).pipe(withUnboundedConcurrency).pipe(runPromise)

    resolve(managed('resource', exit => fx(function* () {
      released.push('resource')
      exits.push(exit)
    })))

    await assert.rejects(task.promise, hasStaleScopeCause)
    assert.deepEqual(released, ['resource'])
    assert.equal(exits.length, 1)
    assert.equal(exits[0]?.type, 'interrupted')
    assert.match(String(exits[0]?.reason), /used after its scope exited/)
  })

  it('usingManagedIn does not register cleanup when initialization fails', () => {
    const released = [] as string[]
    const initFailure = new Error('init failed')

    const result = run(fx(function* () {
      return yield* usingManagedIn(TestScope, fail(initFailure) as Fx<Fail<Error>, Managed<string>>)
    }).pipe(inScope(TestScope), returnFail))

    assert.ok(Fail.is(result))
    assert.equal(result.arg, initFailure)
    assert.deepEqual(released, [])
  })

  it('usingManagedIn finalizer receives the scope exit', () => {
    const exits = [] as Exit[]
    const programFailure = new Error('program failed')

    const result = run(fx(function* () {
      yield* usingManagedIn(TestScope, ok(managed(
        'resource',
        exit => fx(function* () {
          exits.push(exit)
        })
      )))
      yield* fail(programFailure)
    }).pipe(inScope(TestScope), returnFail))

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
      yield* andFinallyIn(TestScope, record(released, 'A'))
      yield* andFinallyIn(TestScope, record(released, 'B'))
      yield* returnFrom(TestScope, 'returned')
    }).pipe(inScope(TestScope), returnFail))

    assert.equal(result, 'returned')
    assert.deepEqual(released, ['B', 'A'])
  })

  it('provides returnFrom exit to exit-aware finalizers', () => {
    const exits = [] as Exit[]

    const result = run(fx(function* () {
      yield* andFinallyIn(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* returnFrom(TestScope, 'returned')
    }).pipe(inScope(TestScope), returnFail))

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
      yield* andFinallyIn(TestScope, record(released, 'A'))
      yield* andFinallyIn(TestScope, record(released, 'B'))
      yield* abort(TestScope)
    }).pipe(inScope(TestScope), orReturn(TestScope, 'aborted'), returnFail))

    assert.equal(result, 'aborted')
    assert.deepEqual(released, ['B', 'A'])
  })

  it('provides abort exit to exit-aware finalizers before re-emitting unhandled abort', () => {
    const exits = [] as Exit[]

    const f = fx(function* () {
      yield* andFinallyIn(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* abort(TestScope)
    }).pipe(inScope(TestScope))

    const next = f[Symbol.iterator]().next()

    assert.equal(Abort.is(next.value), true)
    assert.deepEqual(exits, [{ type: 'abort', scope: TestScope }])
  })

  it('does not run finalizers from a different scope', () => {
    const OtherScope = scope<Control>()('test/Finalization/other')
    const released = [] as string[]

    const f = fx(function* () {
      yield* andFinallyIn(OtherScope, record(released, 'other'))
      return 'done'
    }).pipe(inScope(TestScope))

    const next = f[Symbol.iterator]().next()

    assert.equal(next.done, false)
    assert.deepEqual(released, [])
  })
})

const record = (released: string[], label: string, failure?: unknown) => fx(function* () {
  released.push(label)
  if (failure !== undefined) yield* fail(failure)
})

const drainSync = (f: Fx<unknown, unknown>): void => {
  const iterator = f[Symbol.iterator]()
  for (let result = iterator.next(); !result.done; result = iterator.next()) { }
}

const eventually = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 100; ++i) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('timed out waiting for condition')
}

const hasStaleScopeCause = (error: unknown): boolean =>
  error instanceof Error
  && error.cause instanceof Error
  && /used after its scope exited/.test(error.cause.message)
