import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Fail, assert as assertNoFail, returnFail } from './Fail.js'
import { fx, runPromise, runTask } from './Fx.js'
import { nodeProcess, NodeProcessError, type NodeProcessLike } from './NodeProcess.js'
import { signal, type ProcessSignalName } from './Process.js'
import { runNodeMain, runNodePromise } from './NodeRuntime.js'

describe('NodeProcess', () => {
  it('handles Signal with the requested signals', async () => {
    const process = fakeProcess()

    const running = runPromise(signal(['SIGINT', 'SIGTERM']).pipe(
      nodeProcess({ process }),
      assertNoFail
    ))

    await tick()

    assert.equal(process.count('SIGINT'), 1)
    assert.equal(process.count('SIGTERM'), 1)

    process.emit('SIGTERM')

    assert.equal(await running, 'SIGTERM')
    assert.equal(process.count('SIGINT'), 0)
    assert.equal(process.count('SIGTERM'), 0)
  })

  it('handles Signal with custom signals', async () => {
    const process = fakeProcess()

    const running = runPromise(signal(['SIGHUP']).pipe(
      nodeProcess({ process }),
      assertNoFail
    ))

    await tick()

    assert.equal(process.count('SIGHUP'), 1)
    assert.equal(process.count('SIGINT'), 0)

    process.emit('SIGHUP')

    assert.equal(await running, 'SIGHUP')
    assert.equal(process.count('SIGHUP'), 0)
  })

  it('resolves with the first emitted matching signal', async () => {
    const process = fakeProcess()

    const running = runPromise(signal(['SIGINT', 'SIGQUIT']).pipe(
      nodeProcess({ process }),
      assertNoFail
    ))

    await tick()
    process.emit('SIGQUIT')
    process.emit('SIGINT')

    assert.equal(await running, 'SIGQUIT')
    assert.equal(process.count('SIGINT'), 0)
    assert.equal(process.count('SIGQUIT'), 0)
  })

  it('removes listeners when the waiting computation is aborted', async () => {
    const process = fakeProcess()
    const task = runTask(signal(['SIGINT', 'SIGTERM']).pipe(
      nodeProcess({ process }),
      assertNoFail
    ))

    await tick()

    assert.equal(process.count('SIGINT'), 1)
    assert.equal(process.count('SIGTERM'), 1)

    await task.interrupt()
    await tick()

    assert.equal(process.count('SIGINT'), 0)
    assert.equal(process.count('SIGTERM'), 0)
  })

  it('converts listener setup failures into NodeProcessError failures', async () => {
    const expected = new Error('listener setup failed')
    const process = fakeProcess({
      once: () => {
        throw expected
      }
    })

    const result = await runPromise(signal(['SIGINT', 'SIGTERM']).pipe(
      nodeProcess({ process }),
      returnFail
    ))

    assert.ok(Fail.is(result))
    assert.ok(result.arg instanceof NodeProcessError)
    assert.equal(result.arg.cause, expected)
    assert.equal(process.count('SIGINT'), 0)
    assert.equal(process.count('SIGTERM'), 0)
  })

  it('requires Signal to be handled before runNodeMain', () => {
    if (process.env.FX_TYPECHECK_ONLY === '1') {
      const program = fx(function* () {
        yield* signal(['SIGINT'])
      })

      // @ts-expect-error Signal remains unhandled.
      runNodeMain(program)

      // @ts-expect-error Signal remains unhandled.
      runNodePromise(program)

      runNodeMain(program.pipe(
        nodeProcess({ process: fakeProcess() }),
        assertNoFail
      ), { signals: false, process: fakeProcess() })
    }
  })
})

type FakeProcess = NodeProcessLike & {
  readonly count: (signal: ProcessSignalName) => number
  readonly emit: (signal: ProcessSignalName) => void
}

type FakeProcessOptions = {
  readonly once?: NodeProcessLike['once']
}

const fakeProcess = ({
  once
}: FakeProcessOptions = {}): FakeProcess => {
  const listeners = new Map<ProcessSignalName, Set<() => void>>()
  const fake: FakeProcess = {
    once: (signal, listener) => {
      once?.(signal, listener)
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

  return fake
}

const tick = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0))
