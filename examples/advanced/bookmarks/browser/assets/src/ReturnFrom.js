import { ScopedEffect } from './Effect.js';
/**
 * Return early from the named scope with a value.
 */
export class ReturnFrom extends ScopedEffect('fx/ReturnFrom') {
}
export const returnFrom = (scope, value) => new ReturnFrom(scope, value);
