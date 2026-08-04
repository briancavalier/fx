import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPromise, type Async } from './Async.js'
import { assert as assertNoFail } from './Fail.js'
import { andFinallyIn } from './Finalization.js'
import { fx, type Fx } from './Fx.js'
import { runNodeMain, runNodePromise, type NodeSignalName, type NodeSignalProcess } from './NodeRuntime.js'
import { scope, inScope } from './Scope.js'

describe('NodeRuntime', () => {
  it('installs and removes SIGINT and SIGTERM listeners by default', async () => {
    const process = fakeProcess()

    await runNodePromise(fx(function* () { }), { process })

    assert.equal(process.count('SIGINT'), 0)
    assert.equal(process.count('SIGTERM'), 0)
  })

  it('allows disabling signal handling', async () => {
    const process = fakeProcess()

    await runNodePromise(fx(function* () { }), { process, signals: false })

    assert.equal(process.count('SIGINT'), 0)
    assert.equal(process.count('SIGTERM'), 0)
  })

  it('installs custom signal listeners', async () => {
    const process = fakeProcess()

    await runNodePromise(fx(function* () { }), { process, signals: ['SIGHUP'] })

    assert.equal(process.count('SIGHUP'), 0)
    assert.equal(process.count('SIGINT'), 0)
  })

  it('interrupts the running task when a configured signal arrives', async () => {
    const process = fakeProcess()
    const TestScope = scope('test/NodeRuntime/interrupt')
    let asyncAborted = false
    let released = false

    const running = runNodePromise(fx(function* () {
      yield* andFinallyIn(TestScope, fx(function* () {
        released = true
      }))
      yield* awaitAbort(() => {
        asyncAborted = true
      })
    }).pipe(
      inScope(TestScope),
      assertNoFail
    ), { process })

    await tick()
    assert.equal(process.count('SIGINT'), 1)

    process.emit('SIGINT')
    await running

    assert.equal(asyncAborted, true)
    assert.equal(released, true)
    assert.equal(process.count('SIGINT'), 0)
  })

  it('removes listeners when the program fails', async () => {
    const process = fakeProcess()
    const expected = new Error('failed')

    await assert.rejects(
      runNodePromise(fx(function* () {
        throw expected
      }), { process })
    )

    assert.equal(process.count('SIGINT'), 0)
    assert.equal(process.count('SIGTERM'), 0)
  })

  it('ignores repeated signals after shutdown starts', async () => {
    const process = fakeProcess()
    let aborts = 0

    const running = runNodeMain(fx(function* () {
      yield* awaitAbort(() => {
        aborts += 1
      })
    }), { process })

    await tick()
    process.emit('SIGINT')
    process.emit('SIGINT')
    await running

    assert.equal(aborts, 1)
    assert.equal(process.count('SIGINT'), 0)
  })
})

type FakeProcess = NodeSignalProcess & {
  readonly count: (signal: NodeSignalName) => number
  readonly emit: (signal: NodeSignalName) => void
}

const fakeProcess = (): FakeProcess => {
  const listeners = new Map<NodeSignalName, Set<() => void>>()

  return {
    once: (signal, listener) => {
      const signalListeners = listeners.get(signal) ?? new Set()
      signalListeners.add(listener)
      listeners.set(signal, signalListeners)
    },
    off: (signal, listener) => {
      listeners.get(signal)?.delete(listener)
    },
    count: signal => listeners.get(signal)?.size ?? 0,
    emit: signal => {
      const [listener] = listeners.get(signal) ?? []
      if (listener === undefined) return
      listeners.get(signal)?.delete(listener)
      listener()
    }
  }
}

const awaitAbort = (onAbort: () => void): Fx<Async, void> =>
  assertPromise(signal => new Promise<void>(resolve => {
    signal.addEventListener('abort', () => {
      onAbort()
      resolve()
    })
  }))

const tick = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0))
