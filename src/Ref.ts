export class Ref<A> {
  constructor(private value: A, public readonly compare: (a0: A, a1: A) => boolean = (a0, a1) => a0 === a1) { }

  get(): A {
    return this.value
  }

  unsafeSet(value: A): void {
    this.value = value
  }
}

export const compareAndSet = <const A>(ref: Ref<A>, expectedCurrentValue: A, newValue: A): boolean => {
  if (ref.compare(ref.get(), expectedCurrentValue)) {
    ref.unsafeSet(newValue)
    return true
  }
  return false
}
