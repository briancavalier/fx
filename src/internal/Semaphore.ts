export class Semaphore {
  private waiters: (() => void)[] = [];
  constructor(private available: number) { }

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

const acquiring = (waiters: (() => void)[]): Acquiring => {
  let resolve: () => void
  return {
    promise: new Promise<void>(r => {
      resolve = r
      waiters.push(r)
    }),
    [Symbol.dispose]: () => {
      const i = waiters.indexOf(resolve!)
      if (i >= 0) waiters.splice(i, 1)
    }
  }
}
