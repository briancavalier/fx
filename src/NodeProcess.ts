import { Async, tryPromise } from './Async.js'
import { Fail, catchAll, failFrom } from './Fail.js'
import { Fx } from './Fx.js'
import { Handle, handle } from './Handler.js'
import { Signal, type Process, type ProcessSignalName } from './Process.js'

export type NodeProcessOptions = {
  readonly process?: NodeProcessLike
}

export type NodeProcessLike = {
  readonly once: (signal: ProcessSignalName, listener: () => void) => unknown
  readonly off: (signal: ProcessSignalName, listener: () => void) => unknown
}

/**
 * Failure raised when Node process capability handling fails.
 */
export class NodeProcessError extends Error {
  readonly name = 'NodeProcessError'
}

/**
 * Handle process capability effects using Node process APIs.
 */
export const nodeProcess = ({
  process = globalNodeProcess()
}: NodeProcessOptions = {}) =>
  <const E, const A>(f: Fx<E, A>): Fx<Handle<E, Process, Async | Fail<NodeProcessError>>, A> =>
    f.pipe(
      handle(Signal, signal =>
        waitForSignal(process, signal.arg).pipe(
          catchAll(cause => failFrom(signal, new NodeProcessError('Node process signal failed', { cause })))
        )
      )
    ) as Fx<Handle<E, Process, Async | Fail<NodeProcessError>>, A>

const waitForSignal = (
  process: NodeProcessLike,
  signals: readonly ProcessSignalName[]
): Fx<Async | Fail<unknown>, ProcessSignalName> =>
  tryPromise(abort => new Promise<ProcessSignalName>((resolve, reject) => {
    const listeners: SignalListener[] = []
    let settled = false

    const cleanup = () => {
      abort.removeEventListener('abort', onAbort)
      for (const { signal, listener } of listeners.splice(0)) {
        process.off(signal, listener)
      }
    }

    const done = (signal: ProcessSignalName) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(signal)
    }

    const fail = (cause: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(cause)
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(undefined as never)
    }

    abort.addEventListener('abort', onAbort, { once: true })

    try {
      for (const signal of signals) {
        const listener = () => done(signal)
        listeners.push({ signal, listener })
        process.once(signal, listener)
      }
    } catch (cause) {
      fail(cause)
      return
    }

    if (abort.aborted) onAbort()
  }))

type SignalListener = {
  readonly signal: ProcessSignalName
  readonly listener: () => void
}

const globalNodeProcess = (): NodeProcessLike =>
  (globalThis as unknown as { readonly process: NodeProcessLike }).process
