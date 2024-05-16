import { Effect } from '../../src'

// A Counter effect with a Next operation that increments
// a named counter and returns the new value

export class Next extends Effect('Counter/Next')<string, number> { }

export const next = (key: string) => new Next(key)
