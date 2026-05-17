let interpretingReturn = false

export function* drainIteratorReturn<Y, A, R>(
  iterator: Iterator<Y, A, unknown>,
  step: (ir: IteratorResult<Y, A>) => Generator<Y, R, unknown>
): Generator<Y, R | undefined, unknown> {
  const ir = iterator.return?.()
  if (ir === undefined) return undefined
  return yield* step(ir)
}

export function* drainRuntimeIteratorReturn<Y, A, R>(
  iterator: Iterator<Y, A, unknown>,
  step: (ir: IteratorResult<Y, A>) => Generator<Y, R, unknown>
): Generator<Y, R | undefined, unknown> {
  if (!isInterpretingReturn()) return undefined
  return yield* drainIteratorReturn(iterator, step)
}

export const withInterpretedReturn = <A>(f: () => A): A => {
  // Runtime interruption closes generators by calling iterator.return(). A
  // generator can yield cleanup effects from finally while return() is on the
  // stack, so the flag is intentionally synchronous-only: wrappers may drain
  // those yielded effects only for this runtime close path, not for ordinary
  // user-level control flow or other iterator switching.
  const previous = interpretingReturn
  interpretingReturn = true
  try {
    return f()
  } finally {
    interpretingReturn = previous
  }
}

export const isInterpretingReturn = () => interpretingReturn
