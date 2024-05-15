import { Effect } from '../../src'

export class Increment extends Effect('Counter/Increment')<string, number> { }

export const increment = (key: string) => new Increment(key)
