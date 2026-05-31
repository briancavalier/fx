import { Async } from '../../Async.js';
import { captureTrace } from '../../Trace.js';
const releaseSlotAsync = new WeakSet();
export const markReleaseSlotAsync = (async) => {
    releaseSlotAsync.add(async);
    return async;
};
export const shouldReleaseSlotForAsync = (async) => releaseSlotAsync.has(async);
export const cooperativeAssertPromise = (run, origin) => markReleaseSlotAsync(new Async({
    run,
    origin,
    trace: captureTrace(origin, undefined, { kind: 'async' })
}));
