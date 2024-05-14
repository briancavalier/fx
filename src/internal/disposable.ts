export class DisposableSet {
  private _disposed = false;
  private readonly disposables = [] as Disposable[]

  add(disposable: Disposable) {
    if (this._disposed) disposable[Symbol.dispose]()
    else this.disposables.push(disposable)
  }

  remove(disposable: Disposable) {
    const i = this.disposables.indexOf(disposable)
    if(i >= 0) this.disposables.splice(i, 1)
  }

  get disposed() { return this._disposed }

  [Symbol.dispose]() {
    if (this._disposed) return
    this._disposed = true
    this.disposables.reduceRight((_, d) => d[Symbol.dispose]() as undefined, undefined)
  }
}
