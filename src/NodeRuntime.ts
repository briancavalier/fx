import type { Async } from './Async.js'
import { type Fx, runTask } from './Fx.js'
import type { HandlerCapture } from './HandlerCapture.js'
import type { Interrupt } from './Interrupt.js'

export type NodeSignalName =
  | 'SIGINT'
  | 'SIGTERM'
  | 'SIGHUP'
  | 'SIGQUIT'

export type NodeSignalProcess = {
  readonly once: (signal: NodeSignalName, listener: () => void) => unknown
  readonly off: (signal: NodeSignalName, listener: () => void) => unknown
}

export type RunNodeOptions = {
  readonly process?: NodeSignalProcess
  readonly signals?: readonly NodeSignalName[] | false
}

export type NodeRuntimeEffects =
  | Async
  | Interrupt
  | HandlerCapture<string>

export const runNodeMain = <const E extends NodeRuntimeEffects>(
  program: Fx<E, void>,
  options?: RunNodeOptions
): Promise<void> =>
  runNodePromise(program, options)

export const runNodePromise = <const E extends NodeRuntimeEffects>(
  program: Fx<E, void>,
  {
    process: nodeProcess = globalNodeProcess(),
    signals = ['SIGINT', 'SIGTERM']
  }: RunNodeOptions = {}
): Promise<void> => {
  const task = runTask(program)
  const listeners: SignalListener[] = []
  const stopped = Promise.withResolvers<void>()
  let shuttingDown = false

  const cleanup = () => {
    for (const { signal, listener } of listeners.splice(0)) {
      nodeProcess.off(signal, listener)
    }
  }

  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    cleanup()
    void task._disposeAndWait().then(stopped.resolve, stopped.reject)
  }

  if (signals !== false) {
    for (const signal of signals) {
      const listener = () => shutdown()
      listeners.push({ signal, listener })
      nodeProcess.once(signal, listener)
    }
  }

  return Promise.race([
    task.promise,
    stopped.promise
  ]).finally(cleanup)
}

type SignalListener = {
  readonly signal: NodeSignalName
  readonly listener: () => void
}

const globalNodeProcess = (): NodeSignalProcess =>
  (globalThis as unknown as { readonly process: NodeSignalProcess }).process
