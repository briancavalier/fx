import { Pipeable, pipe } from './pipe'

/**
 * Yield the provided value once, then always return.
 */
export class Once<Y, R> implements Generator<Y, R>, Pipeable {
  private called = false

  constructor(public readonly value: Y) {}

  next(r: R): IteratorResult<Y, R> {
    if(this.called) return { done: true, value: r }
    this.called = true
    return { done: false, value: this.value }
  }

  return(a: R): IteratorResult<Y, R> {
    return { value: a, done: true }
  }

  throw(e: unknown): IteratorResult<Y, R> {
    throw e
  }

  [Symbol.iterator](): Generator<Y, R> {
    return new Once<Y, R>(this.value)
  }

  pipe() { return pipe(this, arguments) }
}

/**
 * Always return the provided value.
 */
export class Ok<R> implements Generator<never, R>, Pipeable {
  constructor(public readonly value: R) {}

  next(): IteratorResult<never, R> {
    return { done: true, value: this.value }
  }

  return(r: R): IteratorResult<never, R> {
    return { done: true, value: r }
  }

  throw(e: unknown): IteratorResult<never, R> {
    throw e
  }

  [Symbol.iterator](): Generator<never, R> {
    return this
  }

  pipe() { return pipe(this, arguments) }
}

/**
 * Always return the result of the provided function.
 */
export class Sync<R> implements Generator<never, R>, Pipeable {
  constructor(public readonly f: () => R) {}

  next(): IteratorResult<never, R> {
    return { done: true, value: this.f() }
  }

  return(a: R): IteratorResult<never, R> {
    return { value: a, done: true }
  }

  throw(e: unknown): IteratorResult<never, R> {
    throw e
  }

  [Symbol.iterator](): Generator<never, R> {
    return this
  }

  pipe() { return pipe(this, arguments) }
}

/**
 * Map the yield values of the provided generator.
 */
export class Map<Y, A, B, N = unknown> implements Pipeable {
    constructor(
    private readonly f: (a: A) => B,
    private readonly i: Generator<Y, A, N>
  ) {}

  [Symbol.iterator]() {
    return new MapIterator<Y, A, B, unknown>(this.f, this.i[Symbol.iterator]())
  }

  pipe() { return pipe(this, arguments) }
}

class MapIterator<Y, A, B, N> {
  constructor(
    private readonly f: (a: A) => B,
    private readonly i: Generator<Y, A, N>
  ) {}

  next(n: N): IteratorResult<Y, B> {
    const r = this.i.next(n)
    return r.done ? { done: true, value: this.f(r.value) } : r
  }

  return(a: A): IteratorResult<Y, B> {
    const r = this.i.return(a)
    return r.done ? { done: true, value: this.f(r.value) } : r
  }

  throw(e: unknown): IteratorResult<Y, B> {
    const r = this.i.throw(e)
    return r.done ? { done: true, value: this.f(r.value) } : r
  }
}

/**
 * Wrap a generator to make it safe to yield* multiple times.
 */
export class Gen<E, A> {
  constructor(public readonly f: () => Generator<E, A>) { }

  [Symbol.iterator](): Iterator<E, A> { return this.f() }

  pipe() { return pipe(this, arguments) }
}
