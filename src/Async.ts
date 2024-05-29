import { Effect } from './Effect'
import { fx } from './Fx'
import { schedule } from './Time'
import { dispose } from './internal/disposable'

type Run<A> = (abort: AbortSignal) => Promise<A>

export class Async extends Effect('fx/Async')<Run<any>> { }

export const run = <const A>(run: Run<A>) => new Async(run).returning<A>()

// TODO: Should this move to Time?
// TODO: Should Sleep be a distinct effect? It might be possible
// to implement it more simply there
export const sleep = (ms: number) => fx(function* () {
  let resolve: () => void
  const promise = new Promise<void>(r => resolve = r)
  const disposable = yield* schedule({ at: ms, task: resolve! })
  const abortSleep = () => dispose(disposable)

  yield* run(s => {
    s.addEventListener('abort', abortSleep, { once: true })
    return promise.finally(() => s.removeEventListener('abort', abortSleep))
  })
})
