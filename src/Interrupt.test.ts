import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise } from './Async.js'
import { Effect } from './Effect.js'
import { fail, returnFail } from './Fail.js'
import { firstSettled, race, unbounded } from './Concurrent.js'
import { managed, using, usingManaged } from './Finalization.js'
import { bracket, fx, ok, run, runPromise, runTask, type Fx } from './Fx.js'
import { control, handle } from './Handler.js'
import { uninterruptible, uninterruptibleMask, type Interrupt, type RestoreInterrupt } from './Interrupt.js'
import { scope, type Exit } from './Scope.js'

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

  it('defers disposal during a masked async computation', async () => {
    let resolve!: () => void
    let aborted = false

    const task = runTask(uninterruptible(assertPromise<void>(signal => new Promise(r => {
      signal.addEventListener('abort', () => {
        aborted = true
      })
      resolve = r
    }))))

    await eventually(() => resolve !== undefined)
    const disposed = task._disposeAndWait()

    assert.equal(aborted, false)
    resolve()
    await disposed
    assert.equal(aborted, false)
  })

  it('runs registered finalizers when interrupted after masked acquire/register', async () => {
    const TestScope = 'test/Interrupt/using' as const
    const exits = [] as Exit[]
    let resolve!: (value: string) => void

    const task = fx(function* () {
      yield* using(
        TestScope,
        assertPromise<string>(() => new Promise(r => {
          resolve = r
        })),
        (_, exit) => fx(function* () {
          exits.push(exit)
        })
      )
    }).pipe(
      scope(TestScope),
      returnFail,
      runTask
    )

    await eventually(() => resolve !== undefined)
    const disposed = task._disposeAndWait()
    resolve('resource')
    await disposed

    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope }])
  })

  it('usingManaged registers finalizers when interrupted after masked acquire/register', async () => {
    const TestScope = 'test/Interrupt/usingManaged' as const
    const exits = [] as Exit[]
    let resolve!: (value: ReturnType<typeof managed<string, never>>) => void

    const task = fx(function* () {
      yield* usingManaged(
        TestScope,
        assertPromise(() => new Promise<ReturnType<typeof managed<string, never>>>(r => {
          resolve = r
        }))
      )
    }).pipe(
      scope(TestScope),
      returnFail,
      runTask
    )

    await eventually(() => resolve !== undefined)
    const disposed = task._disposeAndWait()
    resolve(managed('resource', exit => fx(function* () {
      exits.push(exit)
    })))
    await disposed

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
    const disposed = task._disposeAndWait()
    resolve('resource')
    await disposed

    assert.deepEqual(released, ['resource'])
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
    await task._disposeAndWait()

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
    await task._disposeAndWait()

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
    const disposed = task._disposeAndWait()
    resolveInner()
    await disposed

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
    const disposed = task._disposeAndWait()
    await Promise.resolve()

    assert.equal(restoreAborted, false)
    resolveRestore()
    await disposed

    assert.deepEqual(events, ['outer start', 'outer end'])
    assert.equal(restoreAborted, false)
  })

  it('race cancellation waits for masked acquire/register finalization', async () => {
    const TestScope = 'test/Interrupt/race' as const
    const exits = [] as Exit[]
    let resolveAcquire!: (value: string) => void
    let settled = false

    const loser = fx(function* () {
      yield* using(
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
      firstSettled,
      scope(TestScope),
      returnFail,
      unbounded,
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
    assert.deepEqual(exits, [{ type: 'interrupted', scope: TestScope }])
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
