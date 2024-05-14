import { Effect } from './Effect'

type Run<A> = (abort: AbortSignal) => Promise<A>

export class Async extends Effect('fx/Async')<Run<any>> { }

export const run = <const A>(run: Run<A>) => new Async(run).returning<A>()
