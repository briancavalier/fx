import { Effect } from './Effect'
import { ok } from './Fx'
import { control } from './Handler'

/**
 * Abort a computation without returning a result. Abort represents partial functions,
 * where a result is not defined for some inputs.
 */
export class Abort extends Effect('fx/Abort')<void, never> { }

export const abort = new Abort()

/**
 * Return a default value from a computation that aborts early.
 */
export const orReturn = <const R>(r: R) =>
  control(Abort, _ => ok(r))
