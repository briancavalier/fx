import { Abort } from './Abort.js';
import { isEffect } from './Effect.js';
import { Fail, fail, returnFail } from './Fail.js';
import { Finally } from './Finalization.js';
import { fx } from './Fx.js';
import { HandlerCapture } from './HandlerCapture.js';
import { InterruptFrom } from './InterruptFrom.js';
import { ReturnFrom } from './ReturnFrom.js';
import { drainIteratorReturn, isInterpretingReturn } from './internal/iteratorClose.js';
import { pipeThis } from './internal/pipe.js';
import { interruptionReason, withActiveScope } from './internal/runtimeContext.js';
import { ScopeTypeId, sameScope } from './internal/scopeIdentity.js';
export { ScopeTypeId, sameScope };
export function scope(name, metadata = {}) {
    if (name === undefined)
        return scope;
    const token = {
        ...metadata,
        name
    };
    Object.defineProperty(token, ScopeTypeId, {
        value: name,
        enumerable: false,
        writable: false,
        configurable: false
    });
    return token;
}
export const scopeLabel = (scope) => scope.label ?? scope.name;
const scopeDiagnostic = (scope) => {
    return {
        id: scope[ScopeTypeId],
        label: scopeLabel(scope),
        description: scope.description
    };
};
export function withScope(scope) {
    return (f) => new ScopeBoundary(f, scope);
}
class ScopeBoundary {
    fx;
    scope;
    pipe = pipeThis;
    constructor(fx, scope) {
        this.fx = fx;
        this.scope = scope;
    }
    wrap(fx) {
        return new ScopeBoundary(fx, this.scope);
    }
    *[Symbol.iterator]() {
        const finalizers = [];
        const { scope } = this;
        const activeScope = scopeDiagnostic(scope);
        const i = withActiveScope(activeScope, this.fx)[Symbol.iterator]();
        const captured = {
            wrap: fx => new ScopeBoundary(fx, scope)
        };
        let released = false;
        const release = function* (exit) {
            if (released)
                return [];
            released = true;
            return yield* withActiveScope(activeScope, releaseSafely(finalizers, exit));
        };
        const step = function* (ir) {
            while (!ir.done) {
                if (isEffect(ir.value)) {
                    const effect = ir.value;
                    const effectScope = effect.scope;
                    const matchesScope = effectScope !== undefined && sameScope(effectScope, scope);
                    if (matchesScope && Finally.is(effect)) {
                        finalizers.push(effect.arg);
                        ir = i.next(undefined);
                    }
                    else if (matchesScope && ReturnFrom.is(effect)) {
                        const exit = { type: 'returnFrom', scope, value: effect.arg };
                        const failures = yield* release(exit);
                        if (failures.length > 0)
                            return (yield* withActiveScope(activeScope, failCleanup(failures)));
                        return effect.arg;
                    }
                    else if (matchesScope && Abort.is(effect)) {
                        const exit = { type: 'abort', scope };
                        const failures = yield* release(exit);
                        if (failures.length > 0)
                            return (yield* withActiveScope(activeScope, failCleanup(failures)));
                        return (yield effect);
                    }
                    else if (matchesScope && InterruptFrom.is(effect)) {
                        const exit = interruptedExit(scope, effect.arg);
                        const failures = yield* release(exit);
                        if (failures.length > 0)
                            return (yield* withActiveScope(activeScope, failCleanup(failures)));
                        return (yield effect);
                    }
                    else if (Fail.is(effect)) {
                        const exit = { type: 'failure', failure: effect };
                        const failures = yield* release(exit);
                        if (failures.length > 0)
                            return (yield* withActiveScope(activeScope, failCleanup([effect.arg, ...failures])));
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
                return (yield* withActiveScope(activeScope, failCleanup(failures)));
            return ir.value;
        };
        let completed = false;
        try {
            const value = yield* step(i.next());
            completed = true;
            return value;
        }
        finally {
            const cleanupFailures = yield* collectInterruptedCleanupFailures(scope, release, completed, isInterpretingReturn(), i, step);
            if (cleanupFailures.length > 0)
                yield* withActiveScope(activeScope, failCleanup(cleanupFailures));
        }
    }
}
const collectInterruptedCleanupFailures = function* (scope, release, completed, shouldDrainReturn, iterator, step) {
    const failures = [];
    const exit = interruptedExit(scope, interruptionReason());
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
const interruptedExit = (scope, reason) => reason === undefined
    ? { type: 'interrupted', scope }
    : { type: 'interrupted', scope, reason };
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
