type Waiter = () => void

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
    if (this.waiters.length) this.waiters.shift()!()
    else this.available++
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
  return {
    promise: new Promise<void>(r => waiters.push(waiter = r)),
    [Symbol.dispose]: () => {
      const i = waiters.indexOf(waiter!)
      if (i >= 0) waiters.splice(i, 1)
    }
  }
}
