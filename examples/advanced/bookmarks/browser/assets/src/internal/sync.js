import { Fail } from '../Fail.js';
import { pipe } from './pipe.js';
/**
 * Always return the result of the provided function.
 * If the function throws, returns a {@link Fail} effect with the error.
 */
export class TrySync {
    f;
    called = false;
    constructor(f) {
        this.f = f;
    }
    next(r) {
        if (this.called)
            return { done: true, value: r };
        this.called = true;
        try {
            return { done: true, value: this.f() };
        }
        catch (e) {
            return { done: false, value: new Fail(e) };
        }
    }
    return(a) {
        return { done: true, value: a };
    }
    throw(e) {
        throw e;
    }
    [Symbol.iterator]() {
        return new TrySync(this.f);
    }
    [Symbol.dispose]() {
        this.called = true;
    }
    pipe() { return pipe(this, arguments); }
}
