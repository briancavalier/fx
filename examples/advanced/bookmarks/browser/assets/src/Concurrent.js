import { at, indexed } from './Breadcrumb.js';
import { Effect } from './Effect.js';
import { flatMap, flatten, fx, ok } from './Fx.js';
import { handle } from './Handler.js';
import { handleCaptured, mapCapturedHandlers, withCapturedHandlers } from './HandlerCapture.js';
import { Task, wait as waitTask } from './Task.js';
import { captureTrace } from './Trace.js';
import { Semaphore } from './internal/Semaphore.js';
import { CooperativeRuntime } from './internal/withCoopConcurrency.js';
import { acquireAndRunFork } from './internal/runFork.js';
import { currentRuntimeContext } from './internal/runtimeContext.js';
/**
 * Request that a computation be started concurrently.
 *
 * A `Fork` request returns a {@link Task} handle. The scheduling policy is
 * supplied by handlers such as {@link withBoundedConcurrency} or {@link withUnboundedConcurrency}.
 */
export class Fork extends Effect('fx/Concurrent/Fork') {
}
export const allPolicy = { tag: 'all' };
export const firstSettledPolicy = { tag: 'firstSettled' };
export const firstSuccessPolicy = { tag: 'firstSuccess' };
/**
 * Request that a group of computations run concurrently with a structured
 * settlement policy.
 */
export class Concurrently extends Effect('fx/Concurrent/Concurrently') {
}
/**
 * Start an Fx concurrently and return a {@link Task} handle.
 *
 * Use `fork` when the caller needs explicit control over a child computation's
 * lifetime. Use {@link all} or {@link race} when the caller only needs the
 * structured result.
 *
 * @example
 * const task = yield* fork(fetchUser)
 * const user = yield* wait(task)
 */
export const fork = (f, options) => {
    const trace = traceOrigin(options, 'fx/Concurrent/fork', fork, 'fork');
    return withCapturedHandlers('fx/Concurrent/Fork', f).pipe(flatMap(fx => new Fork({ fx, ...trace })));
};
/**
 * Start a tuple of Fx computations concurrently and return their {@link Task}
 * handles.
 *
 * `forkEach` is the explicit handle-based form of concurrency. The caller owns
 * each returned task and decides when to wait for or interrupt it.
 */
export const forkEach = (fxs, options) => fx(function* () {
    const parent = traceOrigin(options, 'fx/Concurrent/forkEach', forkEach, 'fork');
    const ps = [];
    const kind = childFrameKind(parent.trace);
    for (let i = 0; i < fxs.length; i++) {
        ps.push(yield* fork(fxs[i], childTraceOrigin(parent, i, kind)));
    }
    return ps;
});
/**
 * Request that a tuple of Fx computations run concurrently in a structured
 * scope, returning the tuple of child results directly.
 *
 * @example
 * const [user, posts] = yield* all([fetchUser, fetchPosts])
 */
export const all = (fxs, options) => concurrently(allPolicy, fxs, traceOrigin(options, 'fx/Concurrent/all', all, 'all'));
/**
 * Map an iterable to child computations and run them concurrently in input
 * order.
 *
 * @example
 * const users = yield* mapAll(userIds, id => fetchUser(id))
 */
export const mapAll = (items, f, options) => {
    const trace = traceOrigin(options, 'fx/Concurrent/mapAll', mapAll, 'all');
    return all(Array.from(items, f), trace);
};
/**
 * Request that a tuple of Fx computations race in a structured scope.
 *
 * @example
 * const value = yield* race([primary, fallback])
 */
export const race = (fxs, options) => concurrently(firstSettledPolicy, fxs, traceOrigin(options, 'fx/Concurrent/race', race, 'race'));
/**
 * Request that a group of computations run concurrently with the supplied
 * built-in policy.
 */
export const concurrently = (policy, fxs, options) => {
    const trace = traceOrigin(options, 'fx/Concurrent/concurrently', concurrently, policyFrameKind(policy));
    return mapCapturedHandlers('fx/Concurrent/Concurrently', fxs).pipe(flatMap(fxs => new Concurrently({
        policy,
        fxs: fxs,
        ...trace
    })));
};
/**
 * Provide cooperative concurrency for built-in structured concurrency policies.
 */
export const withCoopConcurrency = (options = {}) => {
    const normalized = normalizeCoopOptions(options, 'withCoopConcurrency');
    const runtime = new CooperativeRuntime(normalized);
    return (f) => withCapturedHandlers('fx/Concurrent/Concurrently', f).pipe(flatMap(fx => withCapturedHandlers('fx/Concurrent/Fork', fx.pipe(handleCaptured('fx/Concurrent/Concurrently', Concurrently, runtime.runConcurrently)))), flatMap(fx => ok(fx.pipe(handleCaptured('fx/Concurrent/Fork', Fork, runtime.runFork)))), flatten);
};
/**
 * Retag a structured concurrency request for first-settled race semantics.
 */
export const firstSettled = (f) => f.pipe(handle(Concurrently, retagConcurrently(firstSettledPolicy)));
/**
 * Retag a structured concurrency request for first-success race semantics.
 */
export const firstSuccess = (f) => f.pipe(handle(Concurrently, retagConcurrently(firstSuccessPolicy)));
/**
 * Failure returned by {@link firstSuccess} when every raced child fails.
 */
export class RaceAllFailed extends Error {
    name = 'RaceAllFailed';
    errors;
    constructor(errors) {
        super('All raced computations failed');
        Object.defineProperty(this, 'code', {
            value: 'FX_RACE_ALL_FAILED',
            enumerable: false,
            writable: false,
            configurable: true
        });
        Object.defineProperty(this, 'errors', {
            value: errors,
            enumerable: false,
            writable: false,
            configurable: true
        });
    }
}
/**
 * Handle Fork by running at most `maxConcurrency` forked computations at once.
 *
 * Structured concurrency policies are interpreted by forking child tasks, so
 * `withBoundedConcurrency` also limits structured child concurrency.
 */
export const withBoundedConcurrency = (maxConcurrency) => (f) => {
    const semaphore = new Semaphore(maxConcurrency);
    return withCapturedHandlers('fx/Concurrent/Fork', f).pipe(flatMap(fx => ok(fx.pipe(handleCaptured('fx/Concurrent/Concurrently', Concurrently, runConcurrently), handleCaptured('fx/Concurrent/Fork', Fork, runForkWith(semaphore))))), flatten);
};
/**
 * Handle Fork by running forked computations without a concurrency limit.
 */
export const withUnboundedConcurrency = withBoundedConcurrency(Infinity);
const runForkWith = (s) => (fork) => ok(acquireAndRunFork(fork.arg, s));
const childFrameKind = (trace) => trace?.frame.kind === 'all' || trace?.frame.kind === 'race' ? trace.frame.kind : 'fork';
const policyFrameKind = (policy) => policy.tag === 'all' ? 'all' : 'race';
const traceOrigin = (options, message, caller, kind) => {
    const origin = options?.origin ?? at(message, caller);
    const trace = options?.trace ?? captureTrace(origin, undefined, { kind });
    return { origin, trace };
};
const childTraceOrigin = (parent, index, kind) => {
    const origin = indexed(parent.origin, index);
    return { origin, trace: captureTrace(origin, parent.trace, { kind, index }) };
};
const runConcurrently = (group) => forkEach(group.arg.fxs, group.arg).pipe(flatMap(tasks => waitTask(taskForPolicy(group.arg.policy, tasks))));
const retagConcurrently = (policy) => (group) => mapCapturedHandlers('fx/Concurrent/Concurrently', group.arg.fxs).pipe(flatMap(fxs => new Concurrently({
    ...group.arg,
    policy,
    fxs: fxs
})));
const taskForPolicy = (policy, tasks) => {
    switch (policy.tag) {
        case 'all': return taskAll(tasks);
        case 'firstSettled': return taskRace(tasks);
        case 'firstSuccess': return taskFirstSuccess(tasks);
    }
};
const taskAll = (tasks) => {
    tasks.forEach(t => t._markHandled());
    const d = new InterruptAll(tasks);
    const p = Promise.all(tasks.map(t => t.promise)).then(async (value) => {
        const cleanupFailures = await d.interrupt();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed(cleanupFailures);
        return value;
    }, async (failure) => {
        const cleanupFailures = await d.interrupt();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed([failure, ...cleanupFailures]);
        throw failure;
    });
    return new Task(p, reason => { void d.interrupt(reason); }, currentRuntimeContext(), d.interrupted);
};
const normalizeCoopOptions = (options, handlerName) => {
    const concurrency = options.concurrency ?? Infinity;
    const yieldBudget = options.yieldBudget ?? 64;
    if (concurrency <= 0 || (concurrency !== Infinity && !Number.isInteger(concurrency))) {
        throw new RangeError(`${handlerName} concurrency must be a positive integer or Infinity, got ${concurrency}`);
    }
    if (yieldBudget <= 0 || !Number.isInteger(yieldBudget)) {
        throw new RangeError(`${handlerName} yieldBudget must be a positive integer, got ${yieldBudget}`);
    }
    return {
        concurrency,
        yieldBudget
    };
};
const taskRace = (tasks) => {
    tasks.forEach(t => t._markHandled());
    const d = new InterruptAll(tasks);
    const p = Promise.race(tasks.map(t => t.promise)).then(async (value) => {
        const cleanupFailures = await d.interrupt();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed(cleanupFailures);
        return value;
    }, async (failure) => {
        const cleanupFailures = await d.interrupt();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed([failure, ...cleanupFailures]);
        throw failure;
    });
    return new Task(p, reason => { void d.interrupt(reason); }, currentRuntimeContext(), d.interrupted);
};
const taskFirstSuccess = (tasks) => {
    tasks.forEach(t => t._markHandled());
    const d = new InterruptAll(tasks);
    const p = firstSuccessfulPromise(tasks).then(async (value) => {
        const cleanupFailures = await d.interrupt();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed(cleanupFailures);
        return value;
    }, async (failure) => {
        const cleanupFailures = await d.interrupt();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed([failure, ...cleanupFailures]);
        throw failure;
    });
    return new Task(p, reason => { void d.interrupt(reason); }, currentRuntimeContext(), d.interrupted);
};
const firstSuccessfulPromise = async (tasks) => {
    const pending = tasks.map((task, index) => task.promise.then(value => ({ type: 'success', index, value }), failure => ({ type: 'failure', index, failure })));
    const failures = [];
    while (pending.length > 0) {
        const { position, result } = await Promise.race(pending.map((p, position) => p.then(result => ({ position, result }))));
        void pending.splice(position, 1);
        if (result.type === 'success')
            return result.value;
        failures[result.index] = result.failure;
    }
    throw new RaceAllFailed(failures);
};
class InterruptAll {
    tasks;
    interruptedResolver = Promise.withResolvers();
    interrupted = this.interruptedResolver.promise;
    interruptedPromise;
    constructor(tasks) {
        this.tasks = tasks;
        this.interrupted.catch(() => { });
    }
    interrupt(reason) {
        this.interruptedPromise ??= Promise.allSettled([...this.tasks].map(t => t.interrupt(reason))).then(results => {
            const failures = results.flatMap(result => result.status === 'rejected' ? cleanupFailuresOf(result.reason) : []);
            if (failures.length > 0)
                this.interruptedResolver.reject(resourceReleaseFailed(failures));
            else
                this.interruptedResolver.resolve();
            return failures;
        });
        return this.interruptedPromise;
    }
}
const resourceReleaseFailed = (failures) => new AggregateError(failures, 'Resource release failed');
const cleanupFailuresOf = (failure) => {
    // TODO: Investigate focused unwrapping for interruption-time ForkError wrappers
    // around rejected Async cleanup, while preserving useful runtime traces.
    const cleanupFailure = isResourceReleaseFailure(failure)
        ? failure
        : typeof failure === 'object' && failure !== null && 'cause' in failure && isResourceReleaseFailure(failure.cause)
            ? failure.cause
            : undefined;
    return cleanupFailure === undefined
        ? [failure]
        : cleanupFailure.errors.flatMap(cleanupFailuresOf);
};
const isResourceReleaseFailure = (failure) => failure instanceof AggregateError && failure.message === 'Resource release failed';
