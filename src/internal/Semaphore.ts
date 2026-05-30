type Waiter = () => boolean

export class Semaphore {
  private waiters: Waiter[] = [];
  private available: number;

  constructor(public readonly total: number) {
    if (total <= 0) throw new RangeError(`Semaphore must be created with total > 0, got ${total}`)
    this.available = Math.floor(total)
  }

  acquire(): Acquiring {
    if (this.available > 0) {
      this.available--
      return acquired()
    }

    return acquire(this.waiters)
  }

  release(): void {
    const waiter = this.waiters.shift()
    if (waiter === undefined) {
      this.available++
    } else {
      queueMicrotask(() => {
        if (!waiter()) this.release()
      })
    }
  }
}

export interface Acquiring {
  promise: Promise<void>,
  [Symbol.dispose](): void
}

const acquired = (): Acquiring => ({
  promise: Promise.resolve(),
  [Symbol.dispose]() { }
})

const acquire = (waiters: Waiter[]): Acquiring => {
  let waiter: Waiter
  let cancelled = false
  return {
    promise: new Promise<void>(r => waiters.push(waiter = () => {
      if (cancelled) return false
      r()
      return true
    })),
    [Symbol.dispose]: () => {
      cancelled = true
      const i = waiters.indexOf(waiter!)
      if (i >= 0) waiters.splice(i, 1)
    }
  }
}
