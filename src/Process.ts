import { at } from './Breadcrumb.js'
import { Effect, withOrigin } from './Effect.js'

export type Process = Signal

export type ProcessSignalName =
  | 'SIGINT'
  | 'SIGTERM'
  | 'SIGHUP'
  | 'SIGQUIT'

/**
 * Request the next matching process signal from the host platform.
 */
export class Signal extends Effect('fx/Process/Signal')<[readonly ProcessSignalName[]], ProcessSignalName> { }

/**
 * Wait for the next matching process signal.
 *
 * When a program owns shutdown signal handling, run it with the runner's
 * default signal handling disabled, for example `runNodeMain(f, { signals: false })`.
 */
export const signal = (signals: readonly ProcessSignalName[]) =>
  withOrigin(new Signal(signals), at('fx/Process/signal', signal))
