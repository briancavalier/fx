import { ScopedEffect } from './Effect.js'
import { Fx } from './Fx.js'

/**
 * Return early from the named scope with a value.
 */
export class ReturnFrom<const Scope extends string, const A> extends ScopedEffect('fx/ReturnFrom')<Scope, A, never> { }

export const returnFrom = <const Scope extends string, const A>(
  scope: Scope,
  value: A
): Fx<ReturnFrom<Scope, A>, never> =>
  new ReturnFrom(scope, value)
