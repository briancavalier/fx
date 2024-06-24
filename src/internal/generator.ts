import { Pipeable, pipe } from './pipe'

/**
 * Yield the provided value once, then always return.
 */
export class Once<Y, R> implements Generator<Y, R>, Pipeable {
  private called = false

  constructor(public readonly value: Y) { }

  next(r: R): IteratorResult<Y, R> {
    if (this.called) return { done: true, value: r }
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
  constructor(public readonly value: R) { }

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
  constructor(public readonly f: () => R) { }

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
 * Map the return value of the provided generator.
 */
export class Map<Y, A, B, N = unknown> implements Pipeable {
  constructor(
    private readonly f: (a: A) => B,
    private readonly i: Generator<Y, A, N>
  ) { }

  [Symbol.iterator]() {
    return new MapIterator<Y, A, B, unknown>(this.f, this.i[Symbol.iterator]())
  }

  pipe() { return pipe(this, arguments) }
}

class MapIterator<Y, A, B, N> {
  constructor(
    private readonly f: (a: A) => B,
    private readonly i: Generator<Y, A, N>
  ) { }

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

export interface HasIterator<E, A> {
  [Symbol.iterator](): Iterator<E, A, unknown>
}

/**
 * Map the return value of the provided generator.
 */
export class FlatMap<Y, Y2, A, B, N = unknown> implements Pipeable {
  constructor(
    private readonly f: (a: A) => HasIterator<Y2, B>,
    private readonly i: Generator<Y, A, N>
  ) { }

  [Symbol.iterator]() {
    return new FlatMapIterator<Y, Y2, A, B, unknown>(this.f, this.i[Symbol.iterator]())
  }

  pipe() { return pipe(this, arguments) }
}

class FlatMapIterator<Y, Y2, A, B, N> {
  private innerDone = false

  constructor(
    private readonly f: (a: A) => HasIterator<Y2, B>,
    private i: Iterator<any, any, any>
  ) { }

  next(n?: N): IteratorResult<Y | Y2, B> {
    const r = this.i.next(n)
    if (r.done) {
      if (this.innerDone) {
        return r
      } else {
        this.innerDone = true
        const i2 = this.f(r.value)
        if (i2 instanceof Ok) return { done: true, value: i2.value }
        this.i = this.f(r.value)[Symbol.iterator]()
        return this.next()
      }
    }
    return r
  }

  return(a: A): IteratorResult<Y | Y2, B> {
    return this.i.return?.(a) ?? { done: true, value: undefined }
  }

  throw(e: unknown): IteratorResult<Y | Y2, B> {
    if (this.i.throw) return this.i.throw(e)
    throw e
  }
}

/**
 * Wrap a generator to make it safe to yield* multiple times.
 */
export class Gen<T, E, A> {
  constructor(public readonly thisArg: T, public readonly f: () => Generator<E, A>) { }

  [Symbol.iterator](): Iterator<E, A> {
    return this.f.call(this.thisArg)
  }

  pipe() { return pipe(this, arguments) }
}
