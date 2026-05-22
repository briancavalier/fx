import { at } from './Breadcrumb.js';
import { Effect, traceOriginOf } from './Effect.js';
import { ok } from './Fx.js';
import { control } from './Handler.js';
import { captureTrace } from './Trace.js';
/**
 * Recoverable failure represented as an effect.
 *
 * Use `Fail<E>` for validation, domain, and platform-boundary failures that
 * callers can handle. Throw JavaScript exceptions only for hard crashes or
 * internal invariants.
 */
export class Fail extends Effect('fx/Fail') {
    origin;
    trace;
    constructor(e, traceOrigin = { origin: at('fx/Fail', Fail) }) {
        super(e);
        this.origin = traceOrigin.origin;
        this.trace = traceOrigin.trace ?? captureTrace(traceOrigin.origin, undefined, { kind: 'fail' });
    }
}
/**
 * Fail with a recoverable error value.
 *
 * The returned Fx never produces a value until a failure handler recovers it.
 */
export const fail = (e, origin = at('fx/Fail/fail', fail)) => new Fail(e, { origin });
/**
 * Fail with an error e, using an effect's diagnostic origin when available.
 */
export const failFrom = (effect, e, fallback = at('fx/Fail/failFrom', failFrom)) => {
    const traceOrigin = traceOriginOf(effect);
    return traceOrigin === undefined
        ? new Fail(e, { origin: fallback })
        : new Fail(e, traceOrigin);
};
/**
 * Catch failures matching a type guard and handle them with the provided function.
 * @example
 *   computation.pipe(catchIf(isAuthError, e => recoverFx))
 */
export const catchIf = (match, handle) => (f) => f.pipe(control((Fail), (_, failure) => (match(failure.arg) ? handle(failure.arg) : failure)));
/**
 * Catch failures that are instances of the given constructor and handles them with the provided function.
 * @example
 *   computation.pipe(catchOnly(AuthError, e => recoverFx))
 */
export const catchOnly = (cls, handle) => catchIf((e) => e instanceof cls, handle);
/**
 * Catch all failures and handle them with the provided function.
 *
 * @example
 * ```ts
 * computation.pipe(catchAll(error => recover(error)))
 * ```
 */
export const catchAll = (handle) => catchIf((_) => true, handle);
/**
 * Catch failures matching a type guard and return the caught error.
 * @example
 *   const resultOrError = computation.pipe(returnIf(isNotFoundError))
 */
export const returnIf = (match) => catchIf(match, ok);
/**
 * Catch failures that are instances of the given constructor and return the caught error.
 * @example
 *   const resultOrNotFoundError = computation.pipe(returnOnly(NotFoundError))
 */
export const returnOnly = (c) => (f) => f.pipe(catchOnly(c, ok));
/**
 * Catch all failures and return the caught error.
 * @example
 *   const resultOrError = computation.pipe(returnAll)
 */
export const returnAll = (f) => f.pipe(catchAll(ok));
/**
 * Catch all failures and return them wrapped in a `Fail` instance.
 * @example
 *   const resultOrFail = computation.pipe(returnFail)
 */
export const returnFail = (f) => f.pipe(control((Fail), (_, failure) => ok(failure)));
/**
 * Assert that an Fx does not fail, throwing the error if it does.
 * @example
 *   const result = trySync(f).pipe(assert) // Crashes if f fails
 */
export const assert = control((Fail), (_, failure) => { throw failure.arg; });
