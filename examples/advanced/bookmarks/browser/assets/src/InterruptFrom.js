import { at } from './Breadcrumb.js';
import { ScopedEffect, withOrigin } from './Effect.js';
import { control } from './Handler.js';
import { sameScope } from './internal/scopeIdentity.js';
/**
 * Interrupt the named scope.
 */
export class InterruptFrom extends ScopedEffect('fx/InterruptFrom') {
}
export function interruptFrom(scope, reason) {
    return withOrigin(new InterruptFrom(scope, reason), at('fx/InterruptFrom/interruptFrom', interruptFrom));
}
/**
 * Recover from interruption of the named scope.
 *
 * The handler runs when an {@link InterruptFrom} for the matching scope reaches
 * this boundary. It does not resume the interrupted computation. Interruptions
 * from other scopes are left visible for another handler.
 */
export const recoverInterrupt = (scope, handler) => (f) => f.pipe(control(InterruptFrom, (_, interrupt) => (sameScope(interrupt.scope, scope)
    ? handler(interrupt.arg)
    : interrupt)));
