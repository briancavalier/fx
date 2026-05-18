import { ScopedEffect } from './Effect.js';
import { fx } from './Fx.js';
import { uninterruptible } from './Interrupt.js';
/**
 * Request that a cleanup operation be run when the named scope exits.
 */
export class Finally extends ScopedEffect('fx/Finally') {
}
/**
 * Register a cleanup operation to run when the named scope exits.
 */
export const andFinally = (scope, f) => new Finally(scope, { finalizer: () => f });
/**
 * Register a cleanup operation that receives the named scope's exit.
 */
export const andFinallyExit = (scope, f) => new Finally(scope, { finalizer: exit => f(exit) });
/**
 * Run an initial operation, register cleanup for its result, and return it.
 */
export const using = (scope, initially, finally_) => uninterruptible(fx(function* () {
    const r = yield* initially;
    yield* andFinally(scope, finally_(r));
    return r;
}));
/**
 * Run an initial operation, register exit-aware cleanup for its result, and return it.
 */
export const usingExit = (scope, initially, finally_) => uninterruptible(fx(function* () {
    const r = yield* initially;
    yield* andFinallyExit(scope, exit => finally_(r, exit));
    return r;
}));
/**
 * Pair a value with cleanup for a named scope.
 */
export const managed = (value, finalizer) => ({
    value,
    finalizer
});
/**
 * Run an initial operation that returns a managed value, register its cleanup, and return its value.
 */
export const usingManaged = (scope, initially) => uninterruptible(fx(function* () {
    const m = yield* initially;
    yield* andFinallyExit(scope, m.finalizer);
    return m.value;
}));
