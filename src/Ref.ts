import { fx, Fx } from './Fx'
import { Pipeable, pipeThis } from './internal/pipe'

/**
 * A shareable mutable reference to a value of type `A` that can be read and updated atomically.
 */
export class Ref<A> implements Pipeable {
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
 * Create a new Ref with the provided value and equality function. If the equality function is not
 * provided, `===` will be used.
 */
export const of = <A>(value: A, equals: (a0: A, a1: A) => boolean = (a0, a1) => a0 === a1): Ref<A> =>
  new Ref(value, equals)

/**
 * Standard cmopare-and-set: If the current value of the Ref is equal to `expectedCurrentValue`, set the Ref value to `newValue`,
 * and return `true`. Otherwise, do not set the Ref value and return `false`.
 * @see https://en.wikipedia.org/wiki/Compare-and-swap
 */
export const compareAndSet = <const A>(ref: Ref<A>, expectedCurrentValue: A, newValue: A): boolean => {
  if (!ref.equals(expectedCurrentValue)) return false
  ref.unsafeSet(newValue)
  return true
}

export const atomically = <E, A, B>(f: (a: A) => Fx<E, readonly [A, B]>) => (r: Ref<A>): Fx<E, B> => _atomically(f, r)

const _atomically = <E, A, B>(f: (a: A) => Fx<E, readonly [A, B]>, r: Ref<A>): Fx<E, B> => fx(function* () {
  const a0 = r.get()
  const [a1, b] = yield* f(a0)
  return compareAndSet(r, a0, a1) ? b : yield* _atomically(f, r)
})
