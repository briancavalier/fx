import { Fail } from '../Fail'
import { Pipeable, pipe } from './pipe'

/**
 * Always return the result of the provided function.
 * If the function throws, returns a {@link Fail} effect with the error.
 */
export class TrySync<R> implements Generator<Fail<unknown>, R>, Pipeable {
  protected called = false;

  constructor(public readonly f: () => R) { }

  next(r: R): IteratorResult<Fail<unknown>, R> {
    if (this.called) return { done: true, value: r }
    this.called = true
    try {
      return { done: true, value: this.f() }
    } catch (e) {
      return { done: false, value: new Fail(e) }
    }
  }

  return(a: R): IteratorResult<never, R> {
    return { done: true, value: a }
  }

  throw(e: unknown): IteratorResult<never, R> {
    throw e
  }

  [Symbol.iterator](): Generator<Fail<unknown>, R> {
    return new TrySync<R>(this.f)
  }

  [Symbol.dispose]() {
    this.called = true
  }

  pipe() { return pipe(this, arguments) }
}
