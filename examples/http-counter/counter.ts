import { Effect } from '../../src'

export class Next extends Effect('Counter/Next')<string, number> { }

export const next = (key: string) => new Next(key)
