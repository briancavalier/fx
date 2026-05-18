import { assertPromise } from './Async.js';
import { Effect } from './Effect.js';
import { ok } from './Fx.js';
import { handle } from './Handler.js';
import { dispose } from './internal/disposable.js';
import { RealClock } from './internal/time.js';
export { VirtualClock } from './internal/time.js';
export class Now extends Effect('fx/Time/Now') {
}
/**
 * Get the current system time as integer milliseconds since the unix epoch.
 * This is subject to system time caveats such as drift, Daylight Savings
 * Time, setting the system time, etc.
 */
export const now = new Now();
export class Monotonic extends Effect('fx/Time/Monotonic') {
}
/**
 * Get the elapsed time in *decimal* milliseconds with fractional microseconds
 * since some fixed point in the past. This is guaranteed to be monotonic: it cannot
 * decrease or be set/changed.
 */
export const monotonic = new Monotonic();
export class Sleep extends Effect('fx/Time/Sleep') {
}
/**
 * Delay the current fork by the specified number of milliseconds.
 */
export const sleep = (ms) => new Sleep(ms);
/**
 * Handle Now, Monotonic, and Schedule using the provided Clock
 */
export const withClock = (c) => (f) => f.pipe(handle(Now, () => ok(c.now())), handle(Monotonic, () => ok(c.monotonic())), handle(Sleep, sleep => assertPromise(signal => new Promise(resolve => {
    const d = c.schedule(sleep.arg, () => {
        signal.removeEventListener('abort', disposeOnAbort);
        resolve();
    });
    const disposeOnAbort = () => dispose(d);
    signal.addEventListener('abort', disposeOnAbort, { once: true });
}))));
/**
 * Handle Now, Monotonic, and Schedule using standard APIs:
 * Date.now, performance.now, and setTimeout.
 */
export const defaultTime = withClock(new RealClock());
