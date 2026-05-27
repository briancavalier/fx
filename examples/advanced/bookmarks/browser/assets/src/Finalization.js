import { ScopedEffect } from './Effect.js';
import { fx } from './Fx.js';
import { uninterruptible } from './Interrupt.js';
/**
 * Request that a cleanup operation be run when the named scope exits.
 *
 * A `withScope(...)` handler interprets `Finally` requests for its matching scope
 * and runs registered finalizers when that scope succeeds, fails, returns,
 * aborts, or is interrupted.
 */
export class Finally extends ScopedEffect('fx/Finally') {
}
/**
 * Register a cleanup operation to run when the named scope exits.
 *
 * Use this when the finalizer does not need to inspect the scope exit.
 */
export const andFinally = (scope, f) => new Finally(scope, () => f);
/**
 * Register a cleanup operation that receives the named scope's exit.
 *
 * Use this when cleanup behavior depends on whether the scope succeeded,
 * failed, returned, aborted, or was interrupted.
 */
export const andFinallyExit = (scope, f) => new Finally(scope, f);
/**
 * Run an initial operation, register cleanup for its result, and return it.
 *
 * Acquisition and finalizer registration happen in an uninterruptible region so
 * an acquired resource is not left without cleanup.
 */
export const using = (scope, initially, finally_) => uninterruptible(fx(function* () {
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
 * Run an initial operation that returns a managed value, register its cleanup,
 * and return its value.
 *
 * Use this when acquisition naturally returns the value and its finalizer
 * together.
 */
export const usingManaged = (scope, initially) => uninterruptible(fx(function* () {
    const m = yield* initially;
    yield* andFinallyExit(scope, m.finalizer);
    return m.value;
}));
