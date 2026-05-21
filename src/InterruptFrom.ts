import { at } from './Breadcrumb.js'
import { ScopedEffect, withOrigin } from './Effect.js'
import { Fx } from './Fx.js'

/**
 * Interrupt the named scope.
 */
export class InterruptFrom<const Scope extends string, Reason = undefined>
  extends ScopedEffect('fx/InterruptFrom')<Scope, Reason, never> { }

export function interruptFrom<const Scope extends string>(
  scope: Scope
): Fx<InterruptFrom<Scope>, never>
export function interruptFrom<const Scope extends string, const Reason>(
  scope: Scope,
  reason: Reason
): Fx<InterruptFrom<Scope, Reason>, never>
export function interruptFrom(scope: string, reason?: unknown): Fx<InterruptFrom<string, unknown>, never> {
  return withOrigin(
    new InterruptFrom(scope, reason),
    at('fx/InterruptFrom/interruptFrom', interruptFrom)
  )
}
