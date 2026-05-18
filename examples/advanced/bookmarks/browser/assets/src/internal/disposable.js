export const dispose = (d) => d[Symbol.dispose]();
export class DisposableSet {
    _disposed = false;
    disposables = [];
    add(disposable) {
        if (this._disposed)
            disposable[Symbol.dispose]();
        else
            this.disposables.push(disposable);
    }
    remove(disposable) {
        const i = this.disposables.indexOf(disposable);
        if (i >= 0)
            this.disposables.splice(i, 1);
    }
    get disposed() { return this._disposed; }
    [Symbol.dispose]() {
        if (this._disposed)
            return;
        this._disposed = true;
        this.disposables.reduceRight((_, d) => d[Symbol.dispose](), undefined);
    }
}
