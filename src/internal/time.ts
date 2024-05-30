import * as Async from '../Async'
import { Fx, handle, ok } from '../Fx'
import { Monotonic, Now, Sleep } from '../Time'

export interface ScheduledTask {
  readonly at: number
  readonly task: () => void
}

export type SleepToAsync<E> = E extends Sleep ? Async.Async : never

export class TimeStep {
  private _monotonic = 0
  private _target = 0
  private _tasks: ScheduledTask[] = []
  private _timeout: any
  private _disposed = false

  constructor(public readonly nowOrigin: bigint) { }

  get monotonic(): number {
    return this._monotonic
  }

  get now(): bigint {
    return this.nowOrigin + BigInt(Math.floor(this._monotonic))
  }

  get target(): number {
    return this._target
  }

  get disposed(): boolean {
    return this._disposed
  }

  [Symbol.dispose](): void {
    this._disposed = true
    this._tasks = []
    this.clearTimeout()
  }

  step(millis: number): Promise<void> {
    if (this._disposed) return Promise.resolve()
    this._target = this._target + Math.max(0, millis)
    return this.runTasks()
  }

  waitAll(): Promise<void> {
    return this.step(Infinity)
  }

  handle = <E, A>(f: Fx<E, A>): Fx<Exclude<E, Now | Monotonic | Sleep> | SleepToAsync<E>, A> => f.pipe(
    handle(Now, () => ok(this.now)),
    handle(Monotonic, () => ok(this.monotonic)),
    handle(Sleep, ms => {
      return Async.run(signal => new Promise<void>(resolve => {
        const time = this._monotonic + Math.max(0, ms)
        const t = { at: time, task: resolve }
        this._tasks.push(t)
        signal.addEventListener('abort', () => {
          const i = this._tasks.indexOf(t)
          if (i >= 0) this._tasks.splice(i, 1)
        })
      }))
    })
  ) as Fx<Exclude<E, Now | Monotonic | Sleep> | SleepToAsync<E>, A>

  private clearTimeout() {
    if (this._timeout) {
      clearTimeout(this._timeout)
      this._timeout = undefined
    }
  }

  private runTasks(): Promise<void> {
    return this._disposed
      ? Promise.resolve()
      : new Promise(resolve => this.runTaskLoop(resolve))
  }

  private runTaskLoop(resolve: () => void): void {
    this._timeout = setTimeout(_ => {
      // More tasks may have been added between timeouts,
      // so have to sort each time
      this._tasks.sort((a, b) => a.at - b.at)

      if (this._disposed || this._tasks.length === 0 || this._tasks[0].at > this._target) {
        this._monotonic = this._target
        return resolve()
      }

      const start = this._monotonic
      if (this._tasks[0].at <= this._target) {
        const t = this._tasks.shift()!
        this._monotonic = t.at
        t.task()
        this.runTaskLoop(resolve)
      }
    }, 0)
  }
}

export class TimeoutDisposable implements Disposable {
  constructor(private readonly timeout: any) { }

  [Symbol.dispose]() {
    clearTimeout(this.timeout)
  }
}
