import { ScopedEffect } from './Effect.js'
import { Fx } from './Fx.js'
import { assertScopeOpen, type AnyControlScope } from './Scope.js'

/**
 * Return early from the named scope with a value.
 */
export class ReturnFrom<const Scope extends AnyControlScope, const A> extends ScopedEffect('fx/ReturnFrom')<Scope, A, never> { }

export const returnFrom = <const Scope extends AnyControlScope, const A>(
  scope: Scope,
  value: A
): Fx<ReturnFrom<Scope, A>, never> => {
  assertScopeOpen(scope)
  return new ReturnFrom(scope, value)
}
