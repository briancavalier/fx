type Waiter = () => void

export class Semaphore {
  private waiters: Waiter[] = [];
  private available: number;

  constructor(available: number) {
    if (available <= 0) throw new RangeError(`Semaphore must have a positive number of available permits, got ${available}`)
    this.available = Math.floor(available)
  }

  acquire(): Acquiring {
    if (this.available > 0) {
      this.available--
      return acquired()
    }

    return acquiring(this.waiters)
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

const acquiring = (waiters: Waiter[]): Acquiring => {
  let waiter: Waiter
  return {
    promise: new Promise<void>(r => {
      waiter = r
      waiters.push(r)
    }),
    [Symbol.dispose]: () => {
      const i = waiters.indexOf(waiter!)
      if (i >= 0) waiters.splice(i, 1)
    }
  }
}
