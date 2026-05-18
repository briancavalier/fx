import { Abort } from './Abort.js';
import { isEffect } from './Effect.js';
import { Fail, fail, returnFail } from './Fail.js';
import { Finally } from './Finalization.js';
import { fx } from './Fx.js';
import { HandlerCapture } from './HandlerCapture.js';
import { ReturnFrom } from './ReturnFrom.js';
import { drainIteratorReturn, isInterpretingReturn } from './internal/iteratorClose.js';
import { pipeThis } from './internal/pipe.js';
import { withActiveScope } from './internal/runtimeContext.js';
export const brand = () => (name) => name;
export function scope(name) {
    return (f) => new ScopeBoundary(f, name);
}
class ScopeBoundary {
    fx;
    scopeName;
    pipe = pipeThis;
    constructor(fx, scopeName) {
        this.fx = fx;
        this.scopeName = scopeName;
    }
    wrap(fx) {
        return new ScopeBoundary(fx, this.scopeName);
    }
    *[Symbol.iterator]() {
        const finalizers = [];
        const { scopeName } = this;
        const i = withActiveScope(scopeName, this.fx)[Symbol.iterator]();
        const captured = {
            wrap: fx => new ScopeBoundary(fx, scopeName)
        };
        let released = false;
        const release = function* (exit) {
            if (released)
                return [];
            released = true;
            return yield* withActiveScope(scopeName, releaseSafely(finalizers, exit));
        };
        const step = function* (ir) {
            while (!ir.done) {
                if (isEffect(ir.value)) {
                    const effect = ir.value;
                    const sameScope = effect.scope === scopeName;
                    if (sameScope && Finally.is(effect)) {
                        finalizers.push(effect.arg.finalizer);
                        ir = i.next(undefined);
                    }
                    else if (sameScope && ReturnFrom.is(effect)) {
                        const exit = { type: 'returnFrom', scope: scopeName, value: effect.arg };
                        const failures = yield* release(exit);
                        if (failures.length > 0)
                            return (yield* withActiveScope(scopeName, failCleanup(failures)));
                        return effect.arg;
                    }
                    else if (sameScope && Abort.is(effect)) {
                        const exit = { type: 'abort', scope: scopeName };
                        const failures = yield* release(exit);
                        if (failures.length > 0)
                            return (yield* withActiveScope(scopeName, failCleanup(failures)));
                        return (yield effect);
                    }
                    else if (Fail.is(effect)) {
                        const exit = { type: 'failure', failure: effect };
                        const failures = yield* release(exit);
                        if (failures.length > 0)
                            return (yield* withActiveScope(scopeName, failCleanup([effect.arg, ...failures])));
                        return (yield effect);
                    }
                    else if (HandlerCapture.is(effect)) {
                        ir = i.next([captured, ...(yield effect)]);
                    }
                    else {
                        ir = i.next(yield effect);
                    }
                }
                else {
                    throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`);
                }
            }
            const exit = { type: 'success', value: ir.value };
            const failures = yield* release(exit);
            if (failures.length > 0)
                return (yield* withActiveScope(scopeName, failCleanup(failures)));
            return ir.value;
        };
        let completed = false;
        try {
            const value = yield* step(i.next());
            completed = true;
            return value;
        }
        finally {
            const cleanupFailures = yield* collectInterruptedCleanupFailures(scopeName, release, completed, isInterpretingReturn(), i, step);
            if (cleanupFailures.length > 0)
                yield* withActiveScope(scopeName, failCleanup(cleanupFailures));
        }
    }
}
const collectInterruptedCleanupFailures = function* (scopeName, release, completed, shouldDrainReturn, iterator, step) {
    const failures = [];
    const exit = { type: 'interrupted', scope: scopeName };
    yield* collectCleanupFailures(failures, function* () {
        failures.push(...yield* release(exit));
    });
    if (!completed && shouldDrainReturn) {
        yield* collectCleanupFailures(failures, function* () {
            const result = yield* returnFail(fx(function* () {
                return yield* drainIteratorReturn(iterator, step);
            }));
            if (Fail.is(result))
                failures.push(result.arg);
        });
    }
    return failures;
};
const collectCleanupFailures = function* (failures, cleanup) {
    try {
        yield* cleanup();
    }
    catch (e) {
        failures.push(e);
    }
};
const releaseSafely = (resources, exit) => fx(function* () {
    const failures = [];
    for (let i = resources.length - 1; i >= 0; --i) {
        const r = yield* returnFail(resources[i](exit));
        if (Fail.is(r))
            failures.push(r.arg);
    }
    return failures;
});
const failCleanup = (failures) => fx(function* () {
    return yield* fail(new AggregateError(failures, 'Resource release failed'));
});
