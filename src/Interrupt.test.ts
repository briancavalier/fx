import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abort, orReturn } from './Abort.js'
import { assertPromise } from './Async.js'
import { Effect } from './Effect.js'
import { fail, Fail, returnFail } from './Fail.js'
import { race, withUnboundedConcurrency } from './Concurrent.js'
import { andFinallyIn, managed, usingIn, usingManagedIn } from './Finalization.js'
import { bracket, finalizing, fx, ok, run, runPromise, runTask, type Fx } from './Fx.js'
import { control, handle } from './Handler.js'
import { InterruptFrom, interruptFrom, recoverInterrupt } from './InterruptFrom.js'
import { uninterruptible, uninterruptibleMask, type Interrupt, type RestoreInterrupt } from './Interrupt.js'
import { returnFrom } from './ReturnFrom.js'
import { currentScope, scope, withScope, type Control, type Exit, type RegionExit } from './Scope.js'

describe('Typed interruption', () => {
  const TestScope = scope('test/InterruptFrom')

  it('recovers matching scoped interruptions without resuming', () => {
    const reason = { type: 'test-interrupt' } as const
    const exits = [] as Exit[]
    let recoveredReason: unknown

    const result = fx(function* () {
      yield* andFinallyIn(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* interruptFrom(TestScope, reason)
    }).pipe(
      withScope(TestScope),
      recoverInterrupt(TestScope, r => {
        recoveredReason = r
        return ok('interrupted')
      }),
      returnFail,
      run
    )

    assert.equal(result, 'interrupted')
    assert.equal(recoveredReason, reason)
    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope, reason }])
  })

  it('types recovery reasons as unknown', () => {
    const reason = { type: 'test-interrupt' } as const
    const recovered = interruptFrom(TestScope, reason).pipe(
      withScope(TestScope),
      recoverInterrupt(TestScope, r => {
        const _: unknown = r
        void _
        return ok('interrupted')
      })
    )

    const _: Fx<never, 'interrupted'> = recovered
    void _
  })

  it('rejects incompatible recovery reason annotations', () => {
    const recovered = interruptFrom(TestScope, 123).pipe(
      withScope(TestScope),
      // @ts-expect-error recovery reasons are unknown until narrowed by the handler
      recoverInterrupt(TestScope, (r: string) => ok(r))
    )

    void recovered
  })

  it('leaves interruptions from other scopes visible', () => {
    const OtherScope = scope('test/InterruptFrom/recover-other')

    const f = fx(function* () {
      yield* interruptFrom(OtherScope, 'other')
      return 'done'
    }).pipe(
      withScope(TestScope),
      recoverInterrupt(TestScope, () => ok('interrupted'))
    )

    const next = f[Symbol.iterator]().next()

    assert.equal(InterruptFrom.is(next.value), true)
    assert.equal((next.value as InterruptFrom<typeof OtherScope, 'other'>).scope, OtherScope)
  })

  it('surfaces cleanup failures before recovering an interruption', () => {
    const cleanupFailure = new Error('cleanup failed')

    const result = fx(function* () {
      yield* andFinallyIn(TestScope, fail(cleanupFailure))
      yield* interruptFrom(TestScope)
    }).pipe(
      withScope(TestScope),
      recoverInterrupt(TestScope, () => ok('interrupted')),
      returnFail,
      run
    )

    assert.ok(result instanceof Fail)
    assert.ok(result.arg instanceof AggregateError)
    assert.deepEqual(result.arg.errors, [cleanupFailure])
  })

  it('provides the reason to exit-aware finalizers', () => {
    const reason = { type: 'test-interrupt' }
    const exits = [] as Exit[]

    const result = fx(function* () {
      yield* andFinallyIn(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* interruptFrom(TestScope, reason)
    }).pipe(
      withScope(TestScope),
      control(InterruptFrom, () => ok('interrupted')),
      returnFail,
      run
    )

    assert.equal(result, 'interrupted')
    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope, reason }])
  })

  it('leaves the interrupt visible after scope cleanup', () => {
    const f = interruptFrom(TestScope).pipe(withScope(TestScope))
    const next = f[Symbol.iterator]().next()

    assert.equal(InterruptFrom.is(next.value), true)
    assert.equal((next.value as InterruptFrom<typeof TestScope>).scope, TestScope)
  })

  it('does not handle interrupts from a different scope', () => {
    const OtherScope = scope('test/InterruptFrom/other')
    const f = fx(function* () {
      yield* interruptFrom(OtherScope)
      return 'done'
    }).pipe(withScope(TestScope))

    const next = f[Symbol.iterator]().next()

    assert.equal(InterruptFrom.is(next.value), true)
    assert.equal((next.value as InterruptFrom<typeof OtherScope>).scope, OtherScope)
  })

  it('surfaces cleanup failures before re-yielding the interrupt', () => {
    const cleanupFailure = new Error('cleanup failed')

    const result = fx(function* () {
      yield* andFinallyIn(TestScope, fail(cleanupFailure))
      yield* interruptFrom(TestScope)
    }).pipe(
      withScope(TestScope),
      control(InterruptFrom, () => ok('interrupted')),
      returnFail,
      run
    )

    assert.ok(result instanceof Fail)
    assert.ok(result.arg instanceof AggregateError)
    assert.deepEqual(result.arg.errors, [cleanupFailure])
  })
})

describe('Interrupt masking', () => {
  it('is transparent for pure computations', () => {
    const masked = uninterruptible(ok('value'))
    const _: Fx<Interrupt, string> = masked
    void _

    assert.equal(run(masked), 'value')
  })

  it('preserves handled effects', () => {
    class Current extends Effect('test/Interrupt/Current')<void, string> { }

    const result = run(fx(function* () {
      return yield* uninterruptible(new Current())
    }).pipe(handle(Current, () => ok('handled'))))

    assert.equal(result, 'handled')
  })

  it('control abort inside uninterruptible drains mask cleanup', () => {
    class Stop extends Effect('test/Interrupt/ControlStop')<void, string> { }
    const events = [] as string[]

    const result = run(uninterruptible(fx(function* () {
      try {
        yield* new Stop()
      } finally {
        events.push('cleanup')
      }
      return 'continued'
    })).pipe(
      control(Stop, () => ok('stopped'))
    ))

    assert.equal(result, 'stopped')
    assert.deepEqual(events, ['cleanup'])
  })

  it('handler closed by control abort drains mask cleanup', () => {
    class Current extends Effect('test/Interrupt/HandlerCurrent')<void, string> { }
    class Stop extends Effect('test/Interrupt/HandlerStop')<void, string> { }
    const events = [] as string[]

    const result = run(uninterruptible(fx(function* () {
      try {
        yield* new Current()
        yield* new Stop()
      } finally {
        events.push('cleanup')
      }
      return 'continued'
    })).pipe(
      handle(Current, () => ok('handled')),
      control(Stop, () => ok('stopped'))
    ))

    assert.equal(result, 'stopped')
    assert.deepEqual(events, ['cleanup'])
  })

  it('defers interruption during a masked async computation', async () => {
    let resolve!: () => void
    let aborted = false

    const task = runTask(uninterruptible(assertPromise<void>(signal => new Promise(r => {
      signal.addEventListener('abort', () => {
        aborted = true
      })
      resolve = r
    }))))

    await eventually(() => resolve !== undefined)
    const interrupted = task.interrupt()

    assert.equal(aborted, false)
    resolve()
    await interrupted
    assert.equal(aborted, false)
  })

  it('runs registered finalizers when interrupted after masked acquire/register', async () => {
    const TestScope = scope('test/Interrupt/usingIn')
    const exits = [] as Exit[]
    let resolve!: (value: string) => void

    const task = fx(function* () {
      yield* usingIn(
        TestScope,
        assertPromise<string>(() => new Promise(r => {
          resolve = r
        })),
        (_, exit) => fx(function* () {
          exits.push(exit)
        })
      )
    }).pipe(
      withScope(TestScope),
      returnFail,
      runTask
    )

    await eventually(() => resolve !== undefined)
    const interrupted = task.interrupt()
    resolve('resource')
    await interrupted

    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope }])
  })

  it('usingManagedIn registers finalizers when interrupted after masked acquire/register', async () => {
    const TestScope = scope('test/Interrupt/usingManagedIn')
    const exits = [] as Exit[]
    let resolve!: (value: ReturnType<typeof managed<string, never>>) => void

    const task = fx(function* () {
      yield* usingManagedIn(
        TestScope,
        assertPromise(() => new Promise<ReturnType<typeof managed<string, never>>>(r => {
          resolve = r
        }))
      )
    }).pipe(
      withScope(TestScope),
      returnFail,
      runTask
    )

    await eventually(() => resolve !== undefined)
    const interrupted = task.interrupt()
    resolve(managed('resource', exit => fx(function* () {
      exits.push(exit)
    })))
    await interrupted

    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope }])
  })

  it('bracket releases when interrupted after masked acquire/setup', async () => {
    const released = [] as string[]
    let resolve!: (value: string) => void

    const task = bracket(
      assertPromise<string>(() => new Promise(r => {
        resolve = r
      })),
      resource => fx(function* () {
        released.push(resource)
      }),
      () => assertPromise(() => new Promise(() => { }))
    ).pipe(runTask)

    await eventually(() => resolve !== undefined)
    const interrupted = task.interrupt()
    resolve('resource')
    await interrupted

    assert.deepEqual(released, ['resource'])
  })

  it('bracket provides a success exit to release', () => {
    const exits = [] as RegionExit[]

    const result = bracket(
      ok('resource'),
      (resource: string, exit: RegionExit) => fx(function* () {
        assert.equal(resource, 'resource')
        exits.push(exit)
      }),
      resource => ok(`${resource}:value` as const)
    ).pipe(run)

    assert.equal(result, 'resource:value')
    assert.deepEqual(exits, [{ type: 'success', value: 'resource:value' }])
  })

  it('bracket provides a failure exit to release', () => {
    const failure = new Error('failed')
    const exits = [] as RegionExit[]

    const result = bracket(
      ok('resource'),
      (resource: string, exit: RegionExit) => fx(function* () {
        assert.equal(resource, 'resource')
        exits.push(exit)
      }),
      () => fail(failure)
    ).pipe(returnFail, run)

    assert.ok(Fail.is(result))
    assert.equal(result.arg, failure)
    assert.equal(exits.length, 1)
    const [exit] = exits
    assert.equal(exit.type, 'failure')
    if (exit.type === 'failure') assert.equal(exit.failure.arg, failure)
  })

  it('finalizing runs cleanup after success and preserves the result', () => {
    const released = [] as string[]

    const program = ok('value').pipe(finalizing(fx(function* () {
      released.push('cleanup')
    })))

    const _: Fx<Interrupt, 'value'> = program
    void _

    assert.equal(run(program), 'value')
    assert.deepEqual(released, ['cleanup'])
  })

  it('finalizing runs cleanup after failure', () => {
    class Cleanup extends Effect('test/Interrupt/finalizing/Cleanup')<string, void> { }
    const failure = new Error('failed')
    const released = [] as string[]

    const program = fail(failure).pipe(finalizing(new Cleanup('cleanup')))

    const _: Fx<Fail<Error> | Cleanup | Interrupt, never> = program
    void _

    const result = program.pipe(
      handle(Cleanup, effect => ok(void released.push(effect.arg))),
      returnFail,
      run
    )

    assert.equal(result.arg, failure)
    assert.deepEqual(released, ['cleanup'])
  })

  it('finalizing provides a success exit to cleanup', () => {
    const exits = [] as RegionExit[]

    const result = ok('value').pipe(
      finalizing(exit => fx(function* () {
        exits.push(exit)
      })),
      run
    )

    assert.equal(result, 'value')
    assert.deepEqual(exits, [{ type: 'success', value: 'value' }])
  })

  it('finalizing provides a failure exit to cleanup', () => {
    const failure = new Error('failed')
    const exits = [] as RegionExit[]

    const result = fail(failure).pipe(
      finalizing(exit => fx(function* () {
        exits.push(exit)
      })),
      returnFail,
      run
    )

    assert.ok(Fail.is(result))
    assert.equal(result.arg, failure)
    assert.equal(exits.length, 1)
    const [exit] = exits
    assert.equal(exit.type, 'failure')
    if (exit.type === 'failure') assert.equal(exit.failure.arg, failure)
  })

  it('finalizing provides a returnFrom exit to cleanup', () => {
    const ControlScope = scope<Control>()('test/Interrupt/finalizing/ReturnFromExit')
    const exits = [] as RegionExit[]

    const result = returnFrom(ControlScope, 'returned').pipe(
      finalizing(exit => fx(function* () {
        exits.push(exit)
      })),
      withScope(ControlScope),
      run
    )

    assert.equal(result, 'returned')
    assert.deepEqual(exits, [{ type: 'returnFrom', value: 'returned' }])
  })

  it('finalizing provides an abort exit to cleanup', () => {
    const ControlScope = scope<Control>()('test/Interrupt/finalizing/AbortExit')
    const exits = [] as RegionExit[]

    const result = abort(ControlScope).pipe(
      finalizing(exit => fx(function* () {
        exits.push(exit)
      })),
      withScope(ControlScope),
      orReturn(ControlScope, 'aborted'),
      run
    )

    assert.equal(result, 'aborted')
    assert.deepEqual(exits, [{ type: 'abort' }])
  })

  it('finalizing provides an interruptFrom exit to cleanup', () => {
    const InterruptScope = scope('test/Interrupt/finalizing/InterruptFromExit')
    const reason = { type: 'lexical-interrupt' }
    const exits = [] as RegionExit[]

    const result = interruptFrom(InterruptScope, reason).pipe(
      finalizing(exit => fx(function* () {
        exits.push(exit)
      })),
      recoverInterrupt(InterruptScope, () => ok('interrupted')),
      run
    )

    assert.equal(result, 'interrupted')
    assert.deepEqual(exits, [{ type: 'interrupted', reason }])
  })

  it('finalizing does not expose unresolved currentScope as a lexical exit scope', () => {
    const LexicalScope = scope('test/Interrupt/finalizing/CurrentScopeLexicalExit')
    const reason = { type: 'current-scope-lexical-interrupt' }
    const exits = [] as RegionExit[]

    const result = interruptFrom(currentScope, reason).pipe(
      finalizing(exit => fx(function* () {
        exits.push(exit)
      })),
      withScope(LexicalScope),
      recoverInterrupt(LexicalScope, () => ok('interrupted')),
      run
    )

    assert.equal(result, 'interrupted')
    assert.deepEqual(exits, [{ type: 'interrupted', reason }])
  })

  it('finalizing surfaces cleanup failure after observing the primary failure', () => {
    const programFailure = new Error('program failed')
    const cleanupFailure = new Error('cleanup failed')
    const exits = [] as RegionExit[]

    const result = fail(programFailure).pipe(
      finalizing(exit => fx(function* () {
        exits.push(exit)
        yield* fail(cleanupFailure)
      })),
      returnFail,
      run
    )

    assert.ok(Fail.is(result))
    assert.equal(result.arg, cleanupFailure)
    assert.equal(exits.length, 1)
    const [exit] = exits
    assert.equal(exit.type, 'failure')
    if (exit.type === 'failure') assert.equal(exit.failure.arg, programFailure)
  })

  it('finalizing runs cleanup exactly once', () => {
    let released = 0

    ok('value').pipe(
      finalizing(fx(function* () {
        released += 1
      })),
      run
    )

    assert.equal(released, 1)
  })

  it('finalizing runs cleanup when interrupted', async () => {
    const released = [] as string[]
    let started = false

    const task = assertPromise<void>(() => new Promise(() => {
      started = true
    })).pipe(
      finalizing(fx(function* () {
        released.push('cleanup')
      })),
      runTask
    )

    await eventually(() => started)
    await task.interrupt()

    assert.deepEqual(released, ['cleanup'])
  })

  it('finalizing provides an interrupted exit when task interruption closes the region', async () => {
    const exits = [] as RegionExit[]
    let started = false

    const task = assertPromise<void>(() => new Promise(() => {
      started = true
    })).pipe(
      finalizing(exit => fx(function* () {
        exits.push(exit)
      })),
      runTask
    )

    await eventually(() => started)
    await task.interrupt()

    assert.deepEqual(exits, [{ type: 'interrupted' }])
  })

  it('finalizing drains async cleanup effects during interruption', async () => {
    const released = [] as string[]
    let started = false

    const task = assertPromise<void>(() => new Promise(() => {
      started = true
    })).pipe(
      finalizing(fx(function* () {
        yield* assertPromise(() => Promise.resolve())
        released.push('cleanup')
      })),
      runTask
    )

    await eventually(() => started)
    await task.interrupt()

    assert.deepEqual(released, ['cleanup'])
  })

  it('finalizing cleanup effects are handled by handlers around the lexical region', () => {
    class Request extends Effect('test/Interrupt/finalizing/Request')<string, void> { }
    const handled = [] as string[]

    fx(function* () {
      yield* new Request('program')
      return 'value'
    }).pipe(
      finalizing(new Request('cleanup')),
      handle(Request, effect => ok(void handled.push(effect.arg))),
      run
    )

    assert.deepEqual(handled, ['program', 'cleanup'])
  })

  it('finalizing cleanup is not handled by handlers inside the protected program', () => {
    class Request<A> extends Effect('test/Interrupt/finalizing/InnerRequest')<string, A> { }
    const handled = [] as string[]

    const result = new Request<string>('program').pipe(
      handle(Request, effect => ok(`inner:${effect.arg}`)),
      finalizing(new Request<void>('cleanup')),
      handle(Request, effect => ok(void handled.push(`outer:${effect.arg}`))),
      run
    )

    assert.equal(result, 'inner:program')
    assert.deepEqual(handled, ['outer:cleanup'])
  })

  it('restore re-enables interruption inside uninterruptibleMask', async () => {
    let restoreStarted = false
    let restoreAborted = false

    const task = runTask(uninterruptibleMask(restore => fx(function* () {
      yield* restore(assertPromise<void>(signal => new Promise(() => {
        restoreStarted = true
        signal.addEventListener('abort', () => {
          restoreAborted = true
        })
      })))
    })))

    await eventually(() => restoreStarted)
    await task.interrupt()

    assert.equal(restoreAborted, true)
  })

  it('fails when restore escapes its uninterruptibleMask region', async () => {
    let restore!: RestoreInterrupt

    const task = runTask(fx(function* () {
      yield* uninterruptibleMask(r => fx(function* () {
        restore = r
      }))
      yield* restore(ok(undefined))
    }))

    await assert.rejects(task.promise, hasInterruptMaskInvariantCause)
  })

  it('fails when restore escapes to a later execution of the same uninterruptibleMask value', async () => {
    let restore!: RestoreInterrupt
    let useEscaped = false

    const program = uninterruptibleMask(r => fx(function* () {
      if (useEscaped) yield* restore(ok(undefined))
      else restore = r
    }))

    await runTask(program).promise
    useEscaped = true

    await assert.rejects(runTask(program).promise, hasInterruptMaskInvariantCause)
  })

  it('escaped restore failure does not mask future interruption', async () => {
    let restore!: RestoreInterrupt
    let started = false
    let aborted = false

    await assert.rejects(runTask(fx(function* () {
      yield* uninterruptibleMask(r => fx(function* () {
        restore = r
      }))
      yield* restore(ok(undefined))
    })).promise, hasInterruptMaskInvariantCause)

    const task = runTask(assertPromise<void>(signal => new Promise(resolve => {
      started = true
      signal.addEventListener('abort', () => {
        aborted = true
        resolve()
      })
    })))

    await eventually(() => started)
    await task.interrupt()

    assert.equal(aborted, true)
  })

  it('nested masks defer interruption until the outermost mask exits', async () => {
    const events = [] as string[]
    let resolveInner!: () => void

    const task = runTask(uninterruptible(fx(function* () {
      events.push('outer start')
      yield* uninterruptible(assertPromise<void>(() => new Promise(r => {
        events.push('inner start')
        resolveInner = r
      })))
      events.push('outer end')
    })))

    await eventually(() => resolveInner !== undefined)
    const interrupted = task.interrupt()
    resolveInner()
    await interrupted

    assert.deepEqual(events, ['outer start', 'inner start', 'outer end'])
  })

  it('restore preserves an outer uninterruptible region', async () => {
    const events = [] as string[]
    let restoreStarted = false
    let restoreAborted = false
    let resolveRestore!: () => void

    const task = runTask(uninterruptible(uninterruptibleMask(restore => fx(function* () {
      events.push('outer start')
      yield* restore(assertPromise<void>(signal => new Promise(resolve => {
        restoreStarted = true
        resolveRestore = resolve
        signal.addEventListener('abort', () => {
          restoreAborted = true
          resolve()
        })
      })))
      events.push('outer end')
    }))))

    await eventually(() => restoreStarted)
    const interrupted = task.interrupt()
    await Promise.resolve()

    assert.equal(restoreAborted, false)
    resolveRestore()
    await interrupted

    assert.deepEqual(events, ['outer start', 'outer end'])
    assert.equal(restoreAborted, false)
  })

  it('race cancellation waits for masked acquire/register finalization', async () => {
    const TestScope = scope('test/Interrupt/race')
    const exits = [] as Exit[]
    let resolveAcquire!: (value: string) => void
    let settled = false

    const loser = fx(function* () {
      yield* usingIn(
        TestScope,
        assertPromise<string>(() => new Promise(r => {
          resolveAcquire = r
        })),
        (_, exit) => fx(function* () {
          exits.push(exit)
        })
      )
    })

    const result = race([ok('winner'), loser]).pipe(
      withScope(TestScope),
      withUnboundedConcurrency,
      returnFail,
      runPromise
    ).then(value => {
      settled = true
      return value
    })

    await eventually(() => resolveAcquire !== undefined)
    await Promise.resolve()
    assert.equal(settled, false)

    resolveAcquire('resource')
    assert.equal(await result, 'winner')
    assert.deepEqual(exits, [{ type: 'success', value: 'winner' }])
  })

  it('preserves failures inside uninterruptible computations', () => {
    const failure = new Error('failed')
    const result = run(uninterruptible(fail(failure).pipe(returnFail)))

    assert.equal(result.arg, failure)
  })
})

const eventually = async (f: () => boolean): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    if (f()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(f(), true)
}

const hasInterruptMaskInvariantCause = (e: unknown): boolean =>
  e instanceof Error
  && (
    e.message === 'Interrupt mask invariant failed'
    || e.cause instanceof Error && e.cause.message === 'Interrupt mask invariant failed'
  )
