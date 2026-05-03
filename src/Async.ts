import { Effect } from './Effect.js'
import { Fail, fail } from './Fail.js'
import { Fx, flatten, ok } from './Fx.js'

type Run<A> = (abort: AbortSignal) => Promise<A>

export class Async extends Effect('fx/Async')<Run<any>> { }

/**
 * Convert an async function into an Fx. If the promise rejects, the error will
 * be propagated as a {@link Fail} effect.
 */
export const tryPromise = <const A>(f: Run<A>): Fx<Async | Fail<unknown>, A> =>
  flatten(assertPromise(signal =>
    Promise.resolve(signal).then(f).then(ok, fail)
  ))

/**
 * Convert an async function into an Fx, asserting that it does not throw or reject.
 * Use {@link tryPromise} instead, if the function might throw or reject. Thrown
 * errors and rejected promises will not be converted to {@link Fail} effects.
 */
export const assertPromise = <const A>(run: Run<A>) => new Async(run) as Fx<Async, A>
