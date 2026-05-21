import { at } from './Breadcrumb.js'
import { ScopedEffect, withOrigin } from './Effect.js'
import { Fx } from './Fx.js'
import { control } from './Handler.js'

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

/**
 * Recover from interruption of the named scope.
 *
 * The handler runs when an {@link InterruptFrom} for the matching scope reaches
 * this boundary. It does not resume the interrupted computation. Interruptions
 * from other scopes are left visible for another handler.
 */
export const recoverInterrupt = <const Scope extends string, const HandlerEffects, const R>(
  scope: Scope,
  handler: (reason: unknown) => Fx<HandlerEffects, R>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<RecoverInterrupt<E, Scope, HandlerEffects>, A | R> =>
    f.pipe(
      control(InterruptFrom, (_, interrupt): Fx<HandlerEffects | InterruptFrom<string, unknown>, R> =>
        (interrupt.scope === scope
          ? handler(interrupt.arg)
          : interrupt as Fx<InterruptFrom<string, unknown>, never>) as Fx<HandlerEffects | InterruptFrom<string, unknown>, R>)
    ) as Fx<RecoverInterrupt<E, Scope, HandlerEffects>, A | R>

type RecoverInterrupt<E, Scope extends string, HandlerEffects> =
  E extends InterruptFrom<infer EffectScope extends string, infer Reason>
  ? Extract<EffectScope, Scope> extends never
    ? E
    : HandlerEffects | ResidualInterrupt<E, Scope, Reason>
  : E

type ResidualInterrupt<E, Scope extends string, Reason> =
  E extends InterruptFrom<infer EffectScope extends string, Reason>
  ? Exclude<EffectScope, Scope> extends never
    ? never
    : InterruptFrom<Exclude<EffectScope, Scope>, Reason>
  : never
