import { Effect } from './Effect'
import { Fail, fail } from './Fail'
import { Fx, flatten, ok } from './Fx'

type Run<A> = (abort: AbortSignal) => Promise<A>

export class Async extends Effect('fx/Async')<Run<any>> { }

export const assertPromise = <const A>(run: Run<A>) => new Async(run).returning<A>()

export const tryPromise = <const A>(f: Run<A>): Fx<Async | Fail<unknown>, A> =>
  flatten(assertPromise(signal => f(signal).then(ok, fail)))
