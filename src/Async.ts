import { Effect } from './Effect'
import { Fx } from './Fx'

type Run<A> = (abort: AbortSignal) => Promise<A>

export class Async extends Effect('fx/Async')<Run<any>> { }

export const run = <const A>(run: Run<A>) => new Async(run).returning<A>()

export const attempt = <const A, const E>(r: (f: (a: Fx<E, A>) => void) => void) =>
  run(signal => {
    return new Promise<Fx<E, A>>((resolve, reject) => {
      r(resolve)
      signal.onabort = () => reject(new Error('Aborted'))
    })
  })
