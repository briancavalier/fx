import { Effect } from './Effect'
import { Fx, handle, ok } from './Fx'
import { ScheduledTask, TimeStep, TimeoutDisposable } from './internal/time'

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

export class Schedule extends Effect('fx/Time/Schedule')<ScheduledTask, Disposable> { }

/**
 * Schedule a task to run after a specified number of milliseconds.
 */
export const schedule = (t: ScheduledTask) => new Schedule(t)

/**
 * Handle Now, Monotonic, and Schedule using standard platform APIs:
 * Date.now, performance.now, and setTimeout.
 */
export const defaultTime = <E, A>(f: Fx<E, A>): Fx<Exclude<E, Now | Monotonic | Schedule>, A> => f.pipe(
  handle(Now, () => ok(Date.now())),
  handle(Monotonic, () => ok(performance.now())),
  handle(Schedule, ({ at, task }) => ok(new TimeoutDisposable(setTimeout(task, at))))
) as Fx<Exclude<E, Now | Monotonic | Schedule>, A>

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
