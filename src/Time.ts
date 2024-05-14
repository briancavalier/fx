import { Effect } from './Effect'
import { handle, ok } from './Fx'

export class Now extends Effect('fx/Time')<void, number> { }

export const now = new Now()

export const builtinDate = handle(Now, () => ok(Date.now()))
