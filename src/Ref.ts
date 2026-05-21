/**
 * A low-level mutable reference primitive.
 */
export class Ref<A> {
  constructor(
    private value: A,
    private readonly equals: (current: A, expected: A) => boolean = Object.is
  ) { }

  get(): A {
    return this.value
  }

  /**
   * If the current value is equal to `expected`, replace it with `next` and return `true`.
   * Otherwise, leave the value unchanged and return `false`.
   */
  compareAndSet(expected: A, next: A): boolean {
    if (!this.equals(this.value, expected)) return false
    this.value = next
    return true
  }
}
