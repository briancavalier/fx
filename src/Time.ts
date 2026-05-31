import { Async, assertPromise } from './Async.js'
import { Effect } from './Effect.js'
import { Fx, ok } from './Fx.js'
import { Handle, handle } from './Handler.js'
import { dispose } from './internal/disposable.js'
import { Clock, RealClock } from './internal/time.js'
import { Schedule } from './internal/timeSchedule.js'

export { VirtualClock } from './internal/time.js'

export class Now extends Effect('fx/Time/Now')<void, number> { }

/**
 * Get the current system time as integer milliseconds since the unix epoch.
 * This is subject to system time caveats such as drift, Daylight Savings
 * Time, setting the system time, etc.
 */
export const now = new Now()

export class Monotonic extends Effect('fx/Time/Monotonic')<void, number> { }

/**
 * Get the elapsed time in *decimal* milliseconds with fractional microseconds
 * since some fixed point in the past. This is guaranteed to be monotonic: it cannot
 * decrease or be set/changed.
 */
export const monotonic = new Monotonic()

export class Sleep extends Effect('fx/Time/Sleep')<number, void> { }

export type Time = Now | Monotonic | Sleep

/**
 * Delay the current fork by the specified number of milliseconds.
 */
export const sleep = (ms: number) => new Sleep(ms)

/**
 * Handle Now, Monotonic, and Schedule using the provided Clock
 */
export const withClock = (c: Clock) => <E, A>(f: Fx<E, A>): Fx<Handle<Handle<E, Sleep, Async>, Now | Monotonic>, A> => f.pipe(
  handle(Now, () => ok(c.now())),
  handle(Monotonic, () => ok(c.monotonic())),
  handle(Schedule, schedule => ok(c.schedule(schedule.arg.ms, schedule.arg.task))),
  handle(Sleep, sleep => assertPromise(signal => new Promise(resolve => {
    const d = c.schedule(sleep.arg, () => {
      signal.removeEventListener('abort', disposeOnAbort)
      resolve()
    })
    const disposeOnAbort = () => dispose(d)
    signal.addEventListener('abort', disposeOnAbort, { once: true })
  })))
) as Fx<Handle<Handle<E, Sleep, Async>, Now | Monotonic>, A>

/**
 * Handle Now, Monotonic, and Schedule using standard APIs:
 * Date.now, performance.now, and setTimeout.
 */
export const defaultTime = withClock(new RealClock())
