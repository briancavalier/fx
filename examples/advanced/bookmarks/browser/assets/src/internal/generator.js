import { pipe } from './pipe.js';
/**
 * Yield the provided value once, then always return.
 */
export class Once {
    value;
    called = false;
    constructor(value) {
        this.value = value;
    }
    next(r) {
        if (this.called)
            return { done: true, value: r };
        this.called = true;
        return { done: false, value: this.value };
    }
    return(a) {
        return { done: true, value: a };
    }
    throw(e) {
        throw e;
    }
    [Symbol.iterator]() {
        return new Once(this.value);
    }
    [Symbol.dispose]() {
        this.called = true;
    }
    pipe() { return pipe(this, arguments); }
}
/**
 * Always return the provided value.
 */
export class Ok {
    value;
    constructor(value) {
        this.value = value;
    }
    next() {
        return { done: true, value: this.value };
    }
    return(r) {
        return { done: true, value: r };
    }
    throw(e) {
        throw e;
    }
    [Symbol.iterator]() {
        return this;
    }
    [Symbol.dispose]() { }
    pipe() { return pipe(this, arguments); }
}
/**
 * Map the return value of the provided generator.
 */
export class Map {
    f;
    i;
    constructor(f, i) {
        this.f = f;
        this.i = i;
    }
    [Symbol.iterator]() {
        return new MapIterator(this.f, this.i[Symbol.iterator]());
    }
    pipe() { return pipe(this, arguments); }
}
class MapIterator {
    f;
    i;
    constructor(f, i) {
        this.f = f;
        this.i = i;
    }
    next(n) {
        const r = this.i.next(n);
        return r.done ? { done: true, value: this.f(r.value) } : r;
    }
    return(a) {
        return this.i.return(a);
    }
    throw(e) {
        return this.i.throw(e);
    }
}
/**
 * Map the return value of the provided generator to a new generator,
 * yield all its values, and then return its result.
 */
export class FlatMap {
    f;
    i;
    constructor(f, i) {
        this.f = f;
        this.i = i;
    }
    [Symbol.iterator]() {
        return new FlatMapIterator(this.f, this.i[Symbol.iterator]());
    }
    pipe() { return pipe(this, arguments); }
}
class FlatMapIterator {
    f;
    i;
    outerDone = false;
    constructor(f, i) {
        this.f = f;
        this.i = i;
    }
    next(n) {
        const r = this.i.next(n);
        if (r.done) {
            if (this.outerDone) {
                return r;
            }
            else {
                this.outerDone = true;
                this.i = this.f(r.value)[Symbol.iterator]();
                return this.i.next();
            }
        }
        return r;
    }
    return(a) {
        return this.i.return?.(a) ?? { done: true, value: undefined };
    }
    throw(e) {
        if (this.i.throw)
            return this.i.throw(e);
        throw e;
    }
}
/**
 * Wrap a generator to make it safe to yield* multiple times.
 */
export class Gen {
    self;
    f;
    constructor(self, f) {
        this.self = self;
        this.f = f;
    }
    [Symbol.iterator]() {
        return this.f.call(this.self);
    }
    pipe() { return pipe(this, arguments); }
}
