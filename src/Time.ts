import { Effect } from './Effect'
import { Fx, handle, ok } from './Fx'
import { ScheduledTask, TimeStep } from './internal/time'

export class Now extends Effect('fx/Time/Now')<void, number> { }

export const now = new Now()

export class Monotonic extends Effect('fx/Time/Monotonic')<void, number> { }

export const monotonic = new Monotonic()

export class Schedule extends Effect('fx/Time/Schedule')<ScheduledTask, Disposable> { }

export const schedule = (t: ScheduledTask) => new Schedule(t)

export const defaultTime = <E, A>(f: Fx<E, A>): Fx<Exclude<E, Now | Monotonic | Schedule>, A> => f.pipe(
  handle(Now, () => ok(Date.now())),
  handle(Monotonic, () => ok(performance.now())),
  handle(Schedule, ({ at, task }) => {
    const t = setTimeout(task, at)
    return ok({
      [Symbol.dispose]: () => clearTimeout(t)
    })
  })
) as Fx<Exclude<E, Now | Monotonic | Schedule>, A>

export const stepTime = (nowOrigin = 0): TimeStep => {
  return new TimeStep(nowOrigin)
}
