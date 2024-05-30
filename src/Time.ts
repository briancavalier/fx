import * as Async from './Async'
import { Effect } from './Effect'
import { Fx, handle, ok } from './Fx'
import { SleepToAsync, TimeStep } from './internal/time'

export class Now extends Effect('fx/Time/Now')<void, number> { }

/**
 * Get the current system time as milliseconds since the unix epoch.
 * This is subject to system time caveats such as drift, Daylight Savings
 * Time, setting the system time, etc.
 */
export const now = new Now()

export class Monotonic extends Effect('fx/Time/Monotonic')<void, number> { }

/**
 * Get the elapsed time in milliseconds since some fixed point in the past.
 * This is guaranteed to be monotonic: it cannot decrease or be set/changed.
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
  handle(Now, () => ok(Date.now())),
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
 * Handle Now, Monotonic, and Schedule using a TimeStep instance that
 * allows time to be controlled manually.  Now will start at 0 or the
 * provided origin, and monotonic time will always start at 0. Time
 * must be advanced explicitly by calling the step(milliseconds) or
 * waitAll() methods.
 *
 * @example
 * // now and monotonic start at 0
 * const s = stepTime()
 *
 * myProgramThatUsesTime.pipe(s.handle, runAsync)
 *
 * // advance time by 1 second
 * // now and monotonic will be 1000, and any tasks scheduled
 * // for up to 1 second will execute
 * await s.step(1000)
 */
export const stepTime = (nowOrigin = 0): TimeStep =>
  new TimeStep(nowOrigin)
