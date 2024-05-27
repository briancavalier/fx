import { Effect } from './Effect'

export class Sink<A> extends Effect('fx/Sink')<void, A> { }

export const next = <A>() => new Sink<A>()
