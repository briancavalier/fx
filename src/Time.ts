import * as Async from './Async'
import { Effect } from './Effect'
import { Fx, handle, ok } from './Fx'
import { Clock, SleepToAsync } from './internal/time'

export { VirtualClock } from './internal/time'

export class Now extends Effect('fx/Time/Now')<void, bigint> { }

/**
 * Get the current system time as integer milliseconds since the unix epoch.
 * This is subject to system time caveats such as drift, Daylight Savings
 * Time, setting the system time, etc.
 */
export const now = new Now()

export class Monotonic extends Effect('fx/Time/Monotonic')<void, number> { }

/**
 * Get the elapsed time in *decimal* milliseconds (i.e. with fractional microseconds)
 * since some fixed point in the past. This is guaranteed to be monotonic: it cannot
 * decrease or be set/changed.
 */
export const monotonic = new Monotonic()

export class Sleep extends Effect('fx/Time/Sleep')<number, void> { }

/**
 * Delay the current fork by the specified number of milliseconds.
 */
export const sleep = (millis: number) => new Sleep(millis)

/**
 * Handle Now, Monotonic, and Schedule using standard platform APIs:
 * Date.now, performance.now, and setTimeout.
 */
export const defaultTime = <E, A>(f: Fx<E, A>): Fx<Exclude<E, Now | Monotonic | Sleep> | SleepToAsync<E>, A> => f.pipe(
  handle(Now, () => ok(BigInt(Date.now()))),
  handle(Monotonic, () => ok(performance.now())),
  handle(Sleep, ms => Async.run(signal => {
    let resolve: () => void
    const p = new Promise<void>(r => resolve = r)
      .finally(() => signal.removeEventListener('abort', abortTimeout))
    const t = setTimeout(resolve!, ms)
    const abortTimeout = () => clearTimeout(t)
    signal.addEventListener('abort', abortTimeout, { once: true })
    return p
  }))
) as Fx<Exclude<E, Now | Monotonic | Sleep> | SleepToAsync<E>, A>

/**
 * Handle Now, Monotonic, and Schedule using the provided Clock
 */
export const withClock = (c: Clock) => <E, A>(f: Fx<E, A>): Fx<Exclude<E, Now | Monotonic | Sleep> | SleepToAsync<E>, A> => f.pipe(
  handle(Now, () => ok(c.now)),
  handle(Monotonic, () => ok(c.monotonic)),
  handle(Sleep, ms => Async.run(signal => new Promise(resolve => {
    const cancel = c.schedule(ms, resolve)
    signal.addEventListener('abort', cancel, { once: true })
  })))
) as Fx<Exclude<E, Now | Monotonic | Sleep> | SleepToAsync<E>, A>
