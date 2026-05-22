import { assertPromise } from './Async.js';
import { fail } from './Fail.js';
import { flatten, ok } from './Fx.js';
import { withActiveRuntimeContext } from './internal/runtimeContext.js';
export class Task {
    promise;
    interruptTask;
    _runtimeContext;
    interruptedPromise;
    interrupted = false;
    handled = false;
    E;
    constructor(promise, interruptTask, _runtimeContext, interruptedPromise = Promise.resolve()) {
        this.promise = promise;
        this.interruptTask = interruptTask;
        this._runtimeContext = _runtimeContext;
        this.interruptedPromise = interruptedPromise;
        this.interruptedPromise.catch(() => { });
    }
    async interrupt(reason) {
        if (!this.interrupted) {
            this.interrupted = true;
            this.promise.catch(() => { });
            this.interruptTask(reason);
        }
        await this.interruptedPromise;
    }
    /** @internal Runtime-owned unhandled fork diagnostic state. */
    get _interrupted() {
        return this.interrupted;
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
export const wait = (t) => flatten(assertPromise(s => {
    t._markHandled();
    const interrupt = () => { void t.interrupt(); };
    s.addEventListener('abort', interrupt);
    const p = t.promise.finally(() => s.removeEventListener('abort', interrupt));
    const context = t._runtimeContext;
    return context === undefined
        ? p.then(ok, fail)
        : p.then(a => withActiveRuntimeContext(context, () => ok(a)), e => withActiveRuntimeContext(context, () => fail(e)));
}));
