import { ScopedEffect } from './Effect.js';
import { map, ok } from './Fx.js';
import { handleScoped } from './Handler.js';
/**
 * Yield a value to the named scope.
 */
export class YieldFrom extends ScopedEffect('fx/YieldFrom') {
}
/**
 * Yield a value to the named scope.
 */
export const yieldFrom = (scope, value) => new YieldFrom(scope, value);
/**
 * Collect all one-way yields from the named scope.
 */
export const collectFrom = (scope) => (f) => {
    const values = [];
    return f.pipe(handleScoped((YieldFrom), scope, effect => ok(void values.push(effect.arg))), map(result => [result, values]));
};
