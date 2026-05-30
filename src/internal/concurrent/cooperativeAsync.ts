import { Async } from '../../Async.js'
import type { Breadcrumb } from '../../Breadcrumb.js'
import type { Fx } from '../../Fx.js'
import { captureTrace } from '../../Trace.js'

const releaseSlotAsync = new WeakSet<Async>()

export const markReleaseSlotAsync = (async: Async): Async => {
  releaseSlotAsync.add(async)
  return async
}

export const shouldReleaseSlotForAsync = (async: Async): boolean =>
  releaseSlotAsync.has(async)

export const cooperativeAssertPromise = <const A>(
  run: (signal: AbortSignal) => Promise<A>,
  origin: Breadcrumb
) => markReleaseSlotAsync(new Async({
  run,
  origin,
  trace: captureTrace(origin, undefined, { kind: 'async' })
})) as Fx<Async, A>
