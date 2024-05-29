import { Fx, handle, ok } from '../Fx'
import { Monotonic, Now, Schedule } from '../Time'

export interface ScheduledTask {
  readonly at: number
  readonly task: () => void
}

export class TimeStep {
  private _monotonic = 0
  private _target = 0
  private _tasks: ScheduledTask[] = []
  private _timeout: any

  constructor(public readonly nowOrigin: number) { }

  get monotonic(): number {
    return this._monotonic
  }

  get now(): number {
    return this.nowOrigin + this._monotonic
  }

  get target(): number {
    return this._target
  }

  step(millis: number): void {
    this._target = this._target + Math.max(0, millis)
    return this._runTasks()
  }

  private _runTasks(): void {
    if (this._timeout) {
      clearTimeout(this._timeout)
      this._timeout = undefined
    }

    this._timeout = setTimeout(_ => {
      if (this._tasks.length === 0) {
        this._monotonic = this._target
        return
      }

      const start = this._monotonic
      this._tasks.sort((a, b) => a.at - b.at)
      if (this._tasks[0].at <= this._target) {
        const t = this._tasks.shift()!
        this._monotonic = t.at
        t.task()
        this._runTasks()
      }
    }, 0)
  }

  handle = <E, A>(f: Fx<E, A>): Fx<Exclude<E, Now | Monotonic | Schedule>, A> => f.pipe(
    handle(Now, () => ok(this.now)),
    handle(Monotonic, () => ok(this.monotonic)),
    handle(Schedule, ({ at, task }) => {
      const time = this._monotonic + Math.max(0, at)
      const t = { at: time, task }
      this._tasks.push(t)
      if (time < this._target) this._runTasks()

      return ok({
        [Symbol.dispose]: () => {
          const i = this._tasks.indexOf(t)
          if (i >= 0) this._tasks.splice(i, 1)
        }
      })
    })
  ) as Fx<Exclude<E, Now | Monotonic | Schedule>, A>
}
