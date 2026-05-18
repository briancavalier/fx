import { at, indexed } from './Breadcrumb.js';
import { Effect } from './Effect.js';
import { flatMap, flatten, fx, ok } from './Fx.js';
import { handleCaptured, mapCapturedHandlers, withCapturedHandlers } from './HandlerCapture.js';
import { Task, wait as waitTask } from './Task.js';
import { captureTrace } from './Trace.js';
import { Semaphore } from './internal/Semaphore.js';
import { acquireAndRunFork } from './internal/runFork.js';
import { currentRuntimeContext } from './internal/runtimeContext.js';
/**
 * Request that a computation be started concurrently, returning a {@link Task}
 * handle for the running computation.
 */
export class Fork extends Effect('fx/Concurrent/Fork') {
}
/**
 * Request that a group of computations be run concurrently in a structured
 * scope, returning all results directly.
 *
 * The request describes structured concurrency. A handler decides how the
 * children are scheduled and how failures cancel siblings.
 */
export class All extends Effect('fx/Concurrent/All') {
}
/**
 * Request that a group of computations be raced in a structured scope,
 * returning the first settled result directly.
 *
 * The request describes structured concurrency. A handler decides how the
 * children are scheduled and how losing children are cancelled.
 */
export class Race extends Effect('fx/Concurrent/Race') {
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
 * each returned task and decides when to wait for or dispose it.
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
 * Run a tuple of Fx computations concurrently in a structured scope, returning
 * the tuple of child results directly.
 *
 * @example
 * const [user, posts] = yield* all([fetchUser, fetchPosts])
 */
export const all = (fxs, options) => {
    const trace = traceOrigin(options, 'fx/Concurrent/all', all, 'all');
    return mapCapturedHandlers('fx/Concurrent/All', fxs).pipe(flatMap(fxs => new All({
        fxs: fxs,
        ...trace
    })));
};
/**
 * Race a tuple of Fx computations in a structured scope, returning the first
 * child result or failure to settle.
 *
 * @example
 * const value = yield* race([primary, fallback])
 */
export const race = (fxs, options) => {
    const trace = traceOrigin(options, 'fx/Concurrent/race', race, 'race');
    return mapCapturedHandlers('fx/Concurrent/Race', fxs).pipe(flatMap(fxs => new Race({
        fxs: fxs,
        ...trace
    })));
};
/**
 * Handle All by running all child computations concurrently in a structured
 * scope. The first child failure fails the parent and cancels siblings.
 *
 * @example
 * await all([fetchUser, fetchPosts]).pipe(
 *   defaultAll,
 *   unbounded,
 *   runPromise
 * )
 */
export const defaultAll = (f) => f.pipe(handleCaptured('fx/Concurrent/All', All, runAll));
/**
 * Handle Race by running child computations concurrently in a structured scope.
 * The first child to settle wins and all losers are cancelled.
 *
 * @example
 * await race([primary, fallback]).pipe(
 *   firstSettled,
 *   unbounded,
 *   runPromise
 * )
 */
export const firstSettled = (f) => f.pipe(handleCaptured('fx/Concurrent/Race', Race, runRace));
/**
 * Handle Race by running child computations concurrently and returning the
 * first successful result. Child failures are ignored until every child has
 * failed, at which point the parent fails with {@link RaceAllFailed}.
 *
 * @example
 * await race([primary, replica, cache]).pipe(
 *   firstSuccess,
 *   unbounded,
 *   runPromise
 * )
 */
export const firstSuccess = (f) => f.pipe(handleCaptured('fx/Concurrent/Race', Race, runFirstSuccessRace));
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
 * Structured handlers such as {@link defaultAll} and {@link firstSettled}
 * elaborate into Fork requests, so `bounded` also limits their child
 * concurrency.
 */
export const bounded = (maxConcurrency) => (f) => withCapturedHandlers('fx/Concurrent/Fork', f).pipe(flatMap(fx => ok(fx.pipe(handleCaptured('fx/Concurrent/Fork', Fork, runForkWith(new Semaphore(maxConcurrency)))))), flatten);
/**
 * Handle Fork by running forked computations without a concurrency limit.
 */
export const unbounded = bounded(Infinity);
const runForkWith = (s) => (fork) => ok(acquireAndRunFork(fork.arg, s));
const childFrameKind = (trace) => trace?.frame.kind === 'all' || trace?.frame.kind === 'race' ? trace.frame.kind : 'fork';
const traceOrigin = (options, message, caller, kind) => {
    const origin = options?.origin ?? at(message, caller);
    const trace = options?.trace ?? captureTrace(origin, undefined, { kind });
    return { origin, trace };
};
const childTraceOrigin = (parent, index, kind) => {
    const origin = indexed(parent.origin, index);
    return { origin, trace: captureTrace(origin, parent.trace, { kind, index }) };
};
const runAll = (all) => forkEach(all.arg.fxs, all.arg).pipe(flatMap(tasks => waitTask(taskAll(tasks))));
const runRace = (race) => forkEach(race.arg.fxs, race.arg).pipe(flatMap(tasks => waitTask(taskRace(tasks))));
const runFirstSuccessRace = (race) => forkEach(race.arg.fxs, race.arg).pipe(flatMap(tasks => waitTask(taskFirstSuccess(tasks))));
const taskAll = (tasks) => {
    tasks.forEach(t => t._markHandled());
    const d = new DisposeAll(tasks);
    const p = Promise.all(tasks.map(t => t.promise)).then(async (value) => {
        const cleanupFailures = await d.disposeAndWait();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed(cleanupFailures);
        return value;
    }, async (failure) => {
        const cleanupFailures = await d.disposeAndWait();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed([failure, ...cleanupFailures]);
        throw failure;
    });
    return new Task(p, d, currentRuntimeContext(), d.disposed);
};
const taskRace = (tasks) => {
    tasks.forEach(t => t._markHandled());
    const d = new DisposeAll(tasks);
    const p = Promise.race(tasks.map(t => t.promise)).then(async (value) => {
        const cleanupFailures = await d.disposeAndWait();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed(cleanupFailures);
        return value;
    }, async (failure) => {
        const cleanupFailures = await d.disposeAndWait();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed([failure, ...cleanupFailures]);
        throw failure;
    });
    return new Task(p, d, currentRuntimeContext(), d.disposed);
};
const taskFirstSuccess = (tasks) => {
    tasks.forEach(t => t._markHandled());
    const d = new DisposeAll(tasks);
    const p = firstSuccessfulPromise(tasks).then(async (value) => {
        const cleanupFailures = await d.disposeAndWait();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed(cleanupFailures);
        return value;
    }, async (failure) => {
        const cleanupFailures = await d.disposeAndWait();
        if (cleanupFailures.length > 0)
            throw resourceReleaseFailed([failure, ...cleanupFailures]);
        throw failure;
    });
    return new Task(p, d, currentRuntimeContext(), d.disposed);
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
class DisposeAll {
    tasks;
    disposedResolver = Promise.withResolvers();
    disposed = this.disposedResolver.promise;
    disposedPromise;
    constructor(tasks) {
        this.tasks = tasks;
        this.disposed.catch(() => { });
    }
    [Symbol.dispose]() { void this.disposeAndWait(); }
    disposeAndWait() {
        this.disposedPromise ??= Promise.allSettled([...this.tasks].map(t => t._disposeAndWait())).then(results => {
            const failures = results.flatMap(result => result.status === 'rejected' ? cleanupFailuresOf(result.reason) : []);
            if (failures.length > 0)
                this.disposedResolver.reject(resourceReleaseFailed(failures));
            else
                this.disposedResolver.resolve();
            return failures;
        });
        return this.disposedPromise;
    }
}
const resourceReleaseFailed = (failures) => new AggregateError(failures, 'Resource release failed');
const cleanupFailuresOf = (failure) => {
    // TODO: Investigate focused unwrapping for disposal-time ForkError wrappers
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
