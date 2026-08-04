import type { Async } from './Async.js'
import { type Fx, runTask } from './Fx.js'
import type { HandlerCapture } from './HandlerCapture.js'
import type { Interrupt } from './Interrupt.js'
import type { RunBoundary } from './internal/typeDiagnostics.js'
import type { ProcessSignalName } from './Process.js'

export type NodeSignalName = ProcessSignalName

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

export const runNodeMain = <const E>(
  program: Fx<E, void> & RunBoundary<E, NodeRuntimeEffects>,
  options?: RunNodeOptions
): Promise<void> =>
  runNodePromise(program, options)

export const runNodePromise = <const E>(
  program: Fx<E, void> & RunBoundary<E, NodeRuntimeEffects>,
  {
    process: nodeProcess = globalNodeProcess(),
    signals = ['SIGINT', 'SIGTERM']
  }: RunNodeOptions = {}
): Promise<void> => {
  const task = runTask(program as Fx<NodeRuntimeEffects, void>)
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
    void task.interrupt().then(stopped.resolve, stopped.reject)
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
