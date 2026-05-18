import { assertPromise } from './Async.js';
import { fail } from './Fail.js';
import { flatten, ok } from './Fx.js';
import { withActiveRuntimeContext } from './internal/runtimeContext.js';
export class Task {
    promise;
    dispose;
    _runtimeContext;
    disposedPromise;
    disposed = false;
    handled = false;
    E;
    constructor(promise, dispose, _runtimeContext, disposedPromise = Promise.resolve()) {
        this.promise = promise;
        this.dispose = dispose;
        this._runtimeContext = _runtimeContext;
        this.disposedPromise = disposedPromise;
        this.disposedPromise.catch(() => { });
    }
    [Symbol.dispose]() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.promise.catch(() => { });
        this.dispose[Symbol.dispose]();
    }
    /** @internal Runtime-owned disposal helper. */
    async _disposeAndWait() {
        this[Symbol.dispose]();
        await this.disposedPromise;
    }
    /** @internal Runtime-owned unhandled fork diagnostic state. */
    get _disposed() {
        return this.disposed;
    }
    /** @internal Runtime-owned unhandled fork diagnostic state. */
    get _handled() {
        return this.handled;
    }
    /** @internal Runtime-owned unhandled fork diagnostic state. */
    _markHandled() {
        this.handled = true;
    }
}
export const dispose = (t) => t[Symbol.dispose]();
export const wait = (t) => flatten(assertPromise(s => {
    t._markHandled();
    const dispose = () => t[Symbol.dispose]();
    s.addEventListener('abort', dispose);
    const p = t.promise.finally(() => s.removeEventListener('abort', dispose));
    const context = t._runtimeContext;
    return context === undefined
        ? p.then(ok, fail)
        : p.then(a => withActiveRuntimeContext(context, () => ok(a)), e => withActiveRuntimeContext(context, () => fail(e)));
}));
