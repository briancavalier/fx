import { Effect } from './Effect'
import { Fail, fail } from './Fail'
import { Fx, flatten, ok } from './Fx'

type Run<A> = (abort: AbortSignal) => Promise<A>

export class Async extends Effect('fx/Async')<Run<any>> { }

/**
 * Convert an async function into an Fx. If the promise rejects, the error will
 * be propagated as a {@link Fail} effect.
 */
export const tryPromise = <const A>(f: Run<A>): Fx<Async | Fail<unknown>, A> =>
  flatten(assertPromise(signal => f(signal).then(ok, fail)))

/**
 * Convert an async function into an Fx, asserting that it does not throw or reject.
 * Use {@link tryPromise} instead, if the function might throw or reject. Thrown
 * errors will not be caught by the Fx runtime, and will crash the process.
 */
export const assertPromise = <const A>(run: Run<A>) => new Async(run) as Fx<Async, A>
