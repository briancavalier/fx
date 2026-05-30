import { at } from './Breadcrumb.js';
import { Abort } from './Abort.js';
import { isEffect } from './Effect.js';
import { Fail, fail, returnFail } from './Fail.js';
import { Finally } from './Finalization.js';
import { fx, ok } from './Fx.js';
import { HandlerCapture } from './HandlerCapture.js';
import { InterruptFrom } from './InterruptFrom.js';
import { ReturnFrom } from './ReturnFrom.js';
import { Fork } from './internal/concurrent/effects.js';
import { cooperativeAssertPromise } from './internal/concurrent/cooperativeAsync.js';
import { drainIteratorReturn, isInterpretingReturn, isInterruptedReturn } from './internal/iteratorClose.js';
import { pipeThis } from './internal/pipe.js';
import { interruptionReason, withActiveScope } from './internal/runtimeContext.js';
import { ScopeTypeId, sameScope, scopeId } from './internal/scopeIdentity.js';
import { ScopedFork } from './internal/scopedFork.js';
export { sameScope, scopeId };
export function scope(id, metadata = {}) {
    if (id === undefined)
        return scope;
    const token = { ...metadata };
    Object.defineProperty(token, ScopeTypeId, {
        value: id,
        enumerable: false,
        writable: false,
        configurable: false
    });
    return token;
}
export const scopeLabel = (scope) => scope.label ?? String(scopeId(scope));
const scopeDiagnostic = (scope) => {
    return {
        id: scopeId(scope),
        label: scopeLabel(scope)
    };
};
export function withScope(scope) {
    return (f) => {
        // ScopeBoundary interprets effects dynamically; this assertion connects the
        // runtime interpreter boundary to the public scoped-effect elimination type.
        return new ScopeBoundary(f, scope);
    };
}
class ScopeBoundary {
    fx;
    scope;
    pipe = pipeThis;
    controller;
    root;
    constructor(fx, scope, controller) {
        this.fx = fx;
        this.scope = scope;
        this.controller = controller;
        this.root = controller === undefined;
    }
    wrap(fx) {
        return new ScopeBoundary(fx, this.scope);
    }
    wrapShared(fx) {
        return this.controller === undefined
            ? new ScopeBoundary(fx, this.scope)
            : new ScopeBoundary(fx, this.scope, this.controller);
    }
    *[Symbol.iterator]() {
        const { scope } = this;
        const controller = this.controller ?? new ScopeController(scope);
        const root = this.root;
        const activeScope = root && scope.diagnostic !== false ? scopeDiagnostic(scope) : undefined;
        const withMaybeActiveScope = (fx) => activeScope === undefined ? fx : withActiveScope(activeScope, fx);
        const i = withMaybeActiveScope(this.fx)[Symbol.iterator]();
        const captured = {
            wrap: fx => new ScopeBoundary(fx, scope)
        };
        const capturedShared = {
            wrap: fx => new ScopeBoundary(fx, scope, controller)
        };
        let released = false;
        const release = function* (exit) {
            if (released)
                return { exit, failures: [] };
            released = true;
            const { exit: finalExit, failures: taskFailures } = yield* withMaybeActiveScope(controller.join(exit));
            const finalizerFailures = yield* withMaybeActiveScope(releaseSafely(controller.finalizers, finalExit));
            return { exit: finalExit, failures: [...taskFailures, ...finalizerFailures] };
        };
        const step = function* (ir) {
            while (!ir.done) {
                if (isEffect(ir.value)) {
                    const effect = ir.value;
                    const effectScope = effect.scope;
                    const matchesScope = effectScope !== undefined && sameScope(effectScope, scope);
                    if (matchesScope && Finally.is(effect)) {
                        controller.addFinalizer(effect.arg);
                        ir = i.next(undefined);
                    }
                    else if (matchesScope && ScopedFork.is(effect)) {
                        const task = yield* controller.fork(effect.arg);
                        ir = i.next(task);
                    }
                    else if (matchesScope && ReturnFrom.is(effect)) {
                        const exit = { type: 'returnFrom', scope, value: effect.arg };
                        if (!root) {
                            controller.requestExit(exit);
                            return effect.arg;
                        }
                        const { failures } = yield* release(exit);
                        const cleanupFailures = failures.flatMap(cleanupFailuresOf);
                        if (cleanupFailures.length > 0)
                            return (yield* withMaybeActiveScope(failCleanup(cleanupFailures)));
                        return effect.arg;
                    }
                    else if (matchesScope && Abort.is(effect)) {
                        const exit = { type: 'abort', scope };
                        if (!root) {
                            controller.requestExit(exit);
                            return undefined;
                        }
                        const { failures } = yield* release(exit);
                        const cleanupFailures = failures.flatMap(cleanupFailuresOf);
                        if (cleanupFailures.length > 0)
                            return (yield* withMaybeActiveScope(failCleanup(cleanupFailures)));
                        return (yield effect);
                    }
                    else if (matchesScope && InterruptFrom.is(effect)) {
                        const exit = interruptedExit(scope, effect.arg);
                        if (!root) {
                            controller.requestExit(exit);
                            return undefined;
                        }
                        const { failures } = yield* release(exit);
                        const cleanupFailures = failures.flatMap(cleanupFailuresOf);
                        if (cleanupFailures.length > 0)
                            return (yield* withMaybeActiveScope(failCleanup(cleanupFailures)));
                        return (yield effect);
                    }
                    else if (Fail.is(effect)) {
                        const exit = { type: 'failure', failure: effect };
                        if (!root) {
                            return (yield effect);
                        }
                        const { failures } = yield* release(exit);
                        const cleanupFailures = failures.flatMap(cleanupFailuresOf);
                        if (cleanupFailures.length > 0)
                            return (yield* withMaybeActiveScope(failCleanup([effect.arg, ...cleanupFailures])));
                        return (yield effect);
                    }
                    else if (HandlerCapture.is(effect)) {
                        const local = effect.arg === 'fx/Concurrent/ForkIn' ? capturedShared : captured;
                        ir = i.next([local, ...(yield effect)]);
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
            if (!root)
                return ir.value;
            const result = yield* release(exit);
            if (result.exit.type === 'failure') {
                const cleanupFailures = result.failures.flatMap(cleanupFailuresOf);
                if (cleanupFailures.length > 0)
                    return (yield* withMaybeActiveScope(failCleanup([result.exit.failure.arg, ...cleanupFailures])));
                return (yield result.exit.failure);
            }
            const cleanupFailures = result.failures.flatMap(cleanupFailuresOf);
            if (cleanupFailures.length > 0)
                return (yield* withMaybeActiveScope(failCleanup(cleanupFailures)));
            if (result.exit.type === 'returnFrom')
                return result.exit.value;
            if (result.exit.type === 'abort')
                return (yield new Abort(result.exit.scope, undefined));
            if (result.exit.type === 'interrupted')
                return (yield new InterruptFrom(result.exit.scope, result.exit.reason));
            return ir.value;
        };
        let completed = false;
        try {
            const value = yield* step(i.next());
            completed = true;
            return value;
        }
        finally {
            const cleanupFailures = root
                ? yield* collectInterruptedCleanupFailures(scope, release, completed, isInterpretingReturn(), i, step)
                : yield* collectInterruptedChildCleanupFailures(completed, isInterpretingReturn(), i, step);
            const filteredCleanupFailures = cleanupFailures.flatMap(cleanupFailuresOf);
            if (filteredCleanupFailures.length > 0)
                yield* withMaybeActiveScope(failCleanup(filteredCleanupFailures));
        }
    }
}
class ScopeController {
    scope;
    finalizers = [];
    tasks = new Map();
    settled;
    constructor(scope) {
        this.scope = scope;
    }
    get exit() {
        return this.settled;
    }
    addFinalizer(finalizer) {
        this.finalizers.push(finalizer);
    }
    *fork(context) {
        const task = (yield new Fork(context));
        task._markHandled();
        this.tasks.set(task, context);
        return task;
    }
    requestExit(exit) {
        this.settled ??= exit;
    }
    join(exit) {
        if (exit.type !== 'success')
            this.requestExit(exit);
        if (this.tasks.size === 0)
            return ok({ exit: this.settled ?? exit, failures: [] });
        return cooperativeAssertPromise(() => this.joinTasks(exit), at('fx/Scope/withScope/join', withScope));
    }
    async joinTasks(initialExit) {
        const failures = [];
        const pending = new Set(this.tasks.keys());
        while (pending.size > 0) {
            removeInterruptedTasks(pending);
            const exit = this.settled;
            if (exit !== undefined && exit.type !== 'success')
                break;
            if (initialExit.type === 'success' && !hasNonDaemonTask(pending, this.tasks))
                break;
            const result = await Promise.race([...pending].map(task => task.promise.then(value => ({ task, status: 'fulfilled', value }), reason => ({ task, status: 'rejected', reason }))));
            pending.delete(result.task);
            if (result.status === 'rejected') {
                this.settled = { type: 'failure', failure: new Fail(result.reason) };
                break;
            }
        }
        const exit = this.settled ?? initialExit;
        removeInterruptedTasks(pending);
        if (pending.size > 0 || exit.type !== 'success') {
            failures.push(...await this.interruptPending(pending, interruptReason(exit)));
        }
        return { exit, failures };
    }
    async interruptPending(tasks, reason) {
        const results = await Promise.allSettled([...tasks].map(task => task.interrupt(reason)));
        return results.flatMap(result => result.status === 'rejected' ? cleanupFailuresOf(result.reason) : []);
    }
}
const hasNonDaemonTask = (pending, tasks) => {
    for (const task of pending) {
        if (tasks.get(task)?.daemon !== true)
            return true;
    }
    return false;
};
const removeInterruptedTasks = (pending) => {
    for (const task of pending) {
        if (task._interrupted)
            pending.delete(task);
    }
};
const collectInterruptedCleanupFailures = function* (scope, release, completed, shouldDrainReturn, iterator, step) {
    const failures = [];
    const exit = interruptedExit(scope, interruptionReason());
    yield* collectCleanupFailures(failures, function* () {
        failures.push(...(yield* release(exit)).failures);
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
const collectInterruptedChildCleanupFailures = function* (completed, shouldDrainReturn, iterator, step) {
    const failures = [];
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
        try {
            const r = yield* returnFail(resources[i](exit));
            if (Fail.is(r))
                failures.push(r.arg);
        }
        catch (e) {
            failures.push(e);
        }
    }
    return failures;
});
const failCleanup = (failures) => fx(function* () {
    return yield* fail(new AggregateError(failures.flatMap(cleanupFailuresOf), 'Resource release failed'));
});
const interruptReason = (exit) => exit.type === 'interrupted' ? exit.reason : undefined;
const cleanupFailuresOf = (failure) => {
    const cleanupFailure = isResourceReleaseFailure(failure)
        ? failure
        : typeof failure === 'object' && failure !== null && 'cause' in failure && isResourceReleaseFailure(failure.cause)
            ? failure.cause
            : undefined;
    if (cleanupFailure === undefined && isInterruptedReturn(failure))
        return [];
    return cleanupFailure === undefined
        ? [failure]
        : cleanupFailure.errors.flatMap(cleanupFailuresOf);
};
const isResourceReleaseFailure = (failure) => failure instanceof AggregateError && failure.message === 'Resource release failed'
    || typeof failure === 'object' && failure !== null
        && 'message' in failure && failure.message === 'Resource release failed'
        && 'errors' in failure && Array.isArray(failure.errors);
