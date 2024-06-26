import { Effect } from './Effect'
import { Fail, fail } from './Fail'
import { flatten, Fx, ok } from './Fx'

type Run<A> = (abort: AbortSignal) => Promise<A>

export class Async extends Effect('fx/Async')<Run<any>> { }

/**
 * Convert an async function into an Fx. If the promise rejects, the error will
 * be propagated as a {@link Fail} effect.
 */
export const tryPromise = <const A>(f: Run<A>): Fx<Async | Fail<unknown>, A> =>
  new Async(signal => f(signal).then(ok, fail))
    .returning<Fx<never, A> | Fx<Fail<any>, never>>()
    .pipe(flatten)
