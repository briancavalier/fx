import { Effect } from './Effect'

type Run<A> = (abort: AbortSignal) => Promise<A>

export class Async extends Effect('fx/Async')<Run<any>> { }

export const run = <const A>(run: Run<A>) => new Async(run).returning<A>()

export const sleep = (ms: number) => run(abort => new Promise<void>(resolve => {
  const timeout = setTimeout(resolve, ms)
  abort.addEventListener('abort', () => clearTimeout(timeout), { once: true })
}))
