import { Effect } from './Effect'
import { Fail, fail } from './Fail'
import { Fx, flatMap, ok } from './Fx'

type Run<A> = (abort: AbortSignal) => Promise<A>

export class Async extends Effect('fx/Async')<Run<any>> { }

export const promise = <const A>(run: Run<A>) => new Async(run).returning<A>()

export const tryPromise: {
  <const A>(tryPromise: Run<A>): Fx<Async | Fail<unknown>, A>
  <const A, const E>(tryPromise: Run<A>, catchError: (e: unknown) => E): Fx<Async | Fail<E>, A>
} = <const A, const E>(tryPromise: Run<A>, catchError?: (e: unknown) => E) =>
    promise<Fx<Async | Fail<E>, A>>(
      s => tryPromise(s).then(
        ok,
        e => catchError ? fail(catchError(e)) : fail(e)
      )
    ).pipe(flatMap(r => r))
