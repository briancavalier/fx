import { Effect } from '../Effect.js'
import type { Fx } from '../Fx.js'

export interface ScheduleContext {
  readonly ms: number
  readonly task: () => void
}

export class Schedule extends Effect('fx/internal/Time/Schedule')<ScheduleContext, Disposable> { }

export const schedule = (ms: number, task: () => void): Fx<Schedule, Disposable> =>
  new Schedule({ ms, task })
