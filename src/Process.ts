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
export class Signal extends Effect('fx/Process/Signal')<readonly ProcessSignalName[], ProcessSignalName> { }

/**
 * Wait for the next matching process signal.
 */
export const signal = (
  signals: readonly ProcessSignalName[] = ['SIGINT', 'SIGTERM']
) =>
  withOrigin(new Signal(signals), at('fx/Process/signal', signal))
