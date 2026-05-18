import { at } from './Breadcrumb.js';
import { Effect } from './Effect.js';
import { fail } from './Fail.js';
import { flatten, ok } from './Fx.js';
import { currentRuntimeContext, withActiveRuntimeContext } from './internal/runtimeContext.js';
import { captureTrace } from './Trace.js';
export class Async extends Effect('fx/Async') {
}
/**
 * Convert an async function into an Fx. If the promise rejects, the error will
 * be propagated as a {@link Fail} effect.
 */
export const tryPromise = (f) => flatten(assertPromise(signal => {
    const context = currentRuntimeContext();
    return Promise.resolve(signal).then(f).then(ok, e => context === undefined
        ? fail(e)
        : withActiveRuntimeContext(context, () => fail(e)));
}, at('fx/Async/tryPromise', tryPromise)));
/**
 * Convert an async function into an Fx, asserting that it does not throw or reject.
 * Use {@link tryPromise} instead, if the function might throw or reject. Thrown
 * errors and rejected promises will not be converted to {@link Fail} effects.
 */
export const assertPromise = (run, origin = at('fx/Async/assertPromise', assertPromise)) => new Async({ run, origin, trace: captureTrace(origin, undefined, { kind: 'async' }) });
