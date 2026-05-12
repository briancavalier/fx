import { Effect } from './Effect.js'
import { Fx } from './Fx.js'

/**
 * Return early from the named scope with a value.
 */
export class ReturnFrom<const Scope extends string, const A> extends Effect('fx/ReturnFrom')<{
  readonly scope: Scope
  readonly value: A
}, never> { }

export const returnFrom = <const Scope extends string, const A>(
  scope: Scope,
  value: A
): Fx<ReturnFrom<Scope, A>, never> =>
  new ReturnFrom({ scope, value })
