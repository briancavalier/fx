import { Pipeable, pipeThis } from './internal/pipe'

export interface Get<A> {
  get(): A
}

export interface Set<A> {
  unsafeSet(a: A): void
}

export interface Equals<A> {
  equals(a: A): boolean
}

export interface Of<A> extends Get<A>, Set<A>, Equals<A> { }

/**
 * A shareable mutable reference to a value of type `A` that can be read and updated atomically.
 */
export class Ref<A> implements Get<A>, Set<A>, Equals<A>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(private value: A, private readonly _equals: (a0: A, a1: A) => boolean) { }

  get(): A {
    return this.value
  }

  unsafeSet(a: A): void {
    this.value = a
  }

  equals(a: A): boolean {
    return this._equals(this.value, a)
  }
}

/**
 * Create a new Ref with the provided value and equality function. If the `equals` function is not
 * provided, `===` will be used.
 */
export const of = <A>(value: A, equals: (a0: A, a1: A) => boolean = (a0, a1) => a0 === a1): Ref<A> =>
  new Ref(value, equals)

/**
 * Standard cmopare-and-set: If the current value of the Ref is equal to `expectedCurrentValue`, set the Ref value to `newValue`,
 * and return `true`. Otherwise, do not set the Ref value and return `false`.
 * @see https://en.wikipedia.org/wiki/Compare-and-swap
 */
export const compareAndSet = <const A>(ref: Equals<A> & Set<A>, expectedCurrentValue: A, newValue: A): boolean => {
  if (!ref.equals(expectedCurrentValue)) return false
  ref.unsafeSet(newValue)
  return true
}
