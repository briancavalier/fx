import { ScopedEffect } from './Effect.js'
import { Fx } from './Fx.js'
import { GlobalScope } from './GlobalScope.js'

/**
 * Return early from the named scope with a value.
 */
export class ReturnFrom<const Scope extends string, const A> extends ScopedEffect('fx/ReturnFrom')<Scope, A, never> { }

export function returnFrom<const A>(
  value: A
): Fx<ReturnFrom<typeof GlobalScope, A>, never>
export function returnFrom<const Scope extends string, const A>(
  scope: Scope,
  value: A
): Fx<ReturnFrom<Scope, A>, never>
export function returnFrom(
  scopeOrValue: unknown,
  maybeValue?: unknown
): Fx<ReturnFrom<string, unknown>, never> {
  return arguments.length === 1
    ? new ReturnFrom(GlobalScope, scopeOrValue)
    : new ReturnFrom(scopeOrValue as string, maybeValue)
}
