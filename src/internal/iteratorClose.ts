let interpretingReturn = false

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
