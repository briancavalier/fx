import type { Async } from '../../Async.js'

const releaseSlotAsync = new WeakSet<Async>()

export const markReleaseSlotAsync = (async: Async): Async => {
  releaseSlotAsync.add(async)
  return async
}

export const shouldReleaseSlotForAsync = (async: Async): boolean =>
  releaseSlotAsync.has(async)
