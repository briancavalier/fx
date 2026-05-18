import { at } from './Breadcrumb.js';
import { get, provideAll } from './Env.js';
import { assert } from './Fail.js';
import { uninterruptibleMask } from './Interrupt.js';
import { isEffect } from './Effect.js';
import * as generator from './internal/generator.js';
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from './internal/interrupt.js';
import { runFork } from './internal/runFork.js';
import { TrySync } from './internal/sync.js';
/**
 * Construct an Fx from a generator that uses `yield*` to produce effects.
 * A generator with a declared runtime parameter receives contextual parameters
 * from {@link Get}; defaulted contextual parameters are not supported because
 * they have runtime arity 0.
 */
export const fx = function () {
    const self = arguments.length === 1 ? undefined : arguments[0];
    const f = arguments.length === 1 ? arguments[0] : arguments[1];
    return f.length === 0
        ? new generator.Gen(self, f)
        : new generator.Gen(self, function* () {
            const ctx = yield* get();
            return yield* f.call(this, ctx);
        });
};
/**
 * Construct an Fx from a pure value. The returned Fx will produce no effects.
 */
export const ok = (a) => new generator.Ok(a);
/**
 * Construct an Fx that produces no effects and returns `undefined`.
 */
export const unit = ok(undefined);
/**
 * Convert an synchronous side-effect function into an Fx. If the function throws,
 * the error will be propagated as a {@link Fail} effect.
 */
export const trySync = (f) => new TrySync(f);
/**
 * Convert an synchronous side-effect function into an Fx, asserting that it
 * does not throw. Use {@link trySync} instead, if the function might throw.
 * Thrown errors will not be caught by the Fx runtime, and will crash the process.
 */
export const assertSync = (f) => assert(trySync(f));
/**
 * Transform the result of an Fx
 */
export const map = (f) => (x) => new generator.Map(f, x);
/**
 * Sequence Fx: the result of the first is used to produce the next.
 */
export const flatMap = (f) => (fa) => new generator.FlatMap(f, fa);
/**
 * Sequence Fx: discard the result of the first and return the result of the second.
 */
export const andThen = (f) => flatMap(() => f);
/**
 * Discard the result of the Fx and return the provided value.
 */
export const andReturn = (b) => map(() => b);
/**
 * Perform side effects and return the original value.
 * @example
 *  // Logs "Hello" and returns "Hello"
 *  ok("Hello").pipe(tap(Console.log))
 */
export const tap = (f) => (fa) => fa.pipe(flatMap(a => f(a).pipe(andReturn(a))));
/**
 * Flatten a nested Fx.
 */
export const flatten = (x) => x.pipe(flatMap(x => x));
/**
 * Execute all the effects of the provided Fx, and return a {@link Task} for its result.
 */
export const runTask = (f, options = {}) => {
    return runFork(f.pipe(provideAll({})), {
        ...options,
        origin: options.origin ?? at('fx/runTask', runTask)
    });
};
/**
 * Execute all the effects of the provided Fx, and return a Promise for its result,
 * discarding the ability to cancel the computation.
 */
export const runPromise = (f, options = {}) => {
    return runTask(f, {
        ...options,
        origin: options.origin ?? at('fx/runPromise', runPromise)
    }).promise;
};
/**
 * Execute all the effects of the provided Fx, and return its result.
 */
export const run = (f) => f.pipe(provideAll({}), f => {
    const i = f[Symbol.iterator]();
    const masks = new InterruptMaskState();
    let ir = i.next();
    const step = (ir) => {
        while (!ir.done) {
            if (InterruptMaskBegin.is(ir.value)) {
                masks.mask(ir.value.arg);
                ir = i.next();
            }
            else if (InterruptMaskEnd.is(ir.value)) {
                masks.unmask(ir.value.arg);
                ir = i.next();
            }
            else if (isEffect(ir.value)) {
                throw new Error('Unhandled effect in run');
            }
            else {
                throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`);
            }
        }
        return ir;
    };
    ir = step(ir);
    if (!masks.balanced) {
        const cleanup = i.return?.(ir.value);
        if (cleanup !== undefined)
            ir = step(cleanup);
    }
    // Handlers such as returnFail can return effects as ordinary values.
    // Those values are not effects that run still needs to interpret.
    if (!isEffect(ir.value))
        masks.assertBalanced();
    return ir.value;
});
/**
 * Ensures that a resource is acquired, used, and then released,
 * even if an error occurs. Runs the `initially` effect to acquire a resource,
 * passes it to `f`, and guarantees that `andFinally` is run with the
 * resource after `f` returns or throws.
 */
export const bracket = (initially, andFinally, f) => uninterruptibleMask(restore => fx(function* () {
    const r = yield* initially;
    try {
        return yield* restore(f(r));
    }
    finally {
        yield* andFinally(r);
    }
}));
