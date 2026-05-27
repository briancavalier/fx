import { Async } from '../Async.js';
import { at, indexed } from '../Breadcrumb.js';
import { Concurrently, RaceAllFailed, allPolicy, firstSettledPolicy, firstSuccessPolicy } from '../Concurrent.js';
import { Fail, fail } from '../Fail.js';
import { fx } from '../Fx.js';
import { captureTrace, getTrace } from '../Trace.js';
import { ForkError, capturePrependTraceWithContext, captureTraceWithContext, originOfUnhandledFail, runtimeContextOfEffect, traceUnhandledFail, traceWithCause } from './forkDiagnostics.js';
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from './interrupt.js';
import { withInterpretedReturn } from './iteratorClose.js';
import { getRuntimeContext, withActiveRuntimeContext } from './runtimeContext.js';
export const runCooperativeConcurrently = (config) => (group) => cooperativeGroupFx(group, config, groupPolicy(group.arg.policy));
const cooperativeGroupFx = (group, config, policy) => fx(function* () {
    const fxs = group.arg.fxs;
    const fibers = [];
    const ready = [];
    const wake = new Wake();
    const context = getRuntimeContext(group);
    const parentTraceOrigin = {
        origin: group.arg.origin,
        trace: group.arg.trace ?? captureTraceWithContext(context, group.arg.origin, undefined, { kind: groupKind(group) })
    };
    const childKind = childFrameKind(parentTraceOrigin.trace);
    let state = policy.init(fxs.length);
    let next = 0;
    let active = 0;
    let done = 0;
    let completed = false;
    let outcome = emptyOutcome(policy, state, fxs.length);
    const startNext = () => {
        while (outcome === undefined && active < config.concurrency && next < fxs.length) {
            const fiber = {
                index: next,
                iterator: fxs[next][Symbol.iterator](),
                traceOrigin: childTraceOriginWithContext(context, parentTraceOrigin, next, childKind),
                masks: new InterruptMaskState(),
                status: 'ready',
                resume: { type: 'next', value: undefined },
                cancelRequested: false,
                cleanupFailures: []
            };
            next++;
            active++;
            fibers.push(fiber);
            ready.push(fiber);
        }
    };
    const finish = (fiber) => {
        if (fiber.status === 'done')
            return;
        fiber.status = 'done';
        fiber.abort?.abort();
        active--;
        done++;
    };
    const settle = (decision) => {
        state = decision.state;
        if (decision.type === 'continue')
            return;
        outcome ??= decision;
        if (decision.cancelRest)
            cancelActiveFibers(fibers);
    };
    const succeedFiber = (fiber, value) => {
        finish(fiber);
        settle(policy.onSuccess(state, fiber.index, value));
    };
    const failFiber = (fiber, failure) => {
        finish(fiber);
        settle(policy.onFailure(state, fiber.index, failure.error));
    };
    try {
        while (done < fxs.length || next < fxs.length) {
            startNext();
            if (ready.length === 0) {
                if (active === 0)
                    break;
                ready.push(...(yield* wake.wait()));
                continue;
            }
            const fiber = ready.shift();
            if (fiber.status !== 'ready')
                continue;
            if (fiber.cancelRequested && fiber.masks.canInterrupt) {
                yield* closeFiber(fiber);
                finish(fiber);
                continue;
            }
            let budget = config.yieldBudget;
            while (budget > 0 && fiber.status === 'ready') {
                budget--;
                let ir;
                try {
                    ir = fiber.resume.type === 'throw'
                        ? fiber.iterator.throw?.(fiber.resume.error) ?? throwIntoMissingIterator(fiber.resume.error)
                        : fiber.iterator.next(fiber.resume.value);
                }
                catch (e) {
                    failFiber(fiber, { error: wrapThrownFiberError(fiber, e) });
                    break;
                }
                fiber.resume = { type: 'next', value: undefined };
                if (ir.done) {
                    succeedFiber(fiber, ir.value);
                    break;
                }
                if (Async.is(ir.value)) {
                    startCooperativeAsync(fiber, ir.value, wake, failFiber);
                    break;
                }
                if (Concurrently.is(ir.value)) {
                    fiber.resume = { type: 'next', value: yield* runCooperativeConcurrently(config)(ir.value) };
                    continue;
                }
                if (Fail.is(ir.value)) {
                    failFiber(fiber, { error: wrapFiberFailure(fiber, ir.value) });
                    break;
                }
                if (InterruptMaskBegin.is(ir.value)) {
                    fiber.masks.mask(ir.value.arg);
                    fiber.resume = { type: 'next', value: undefined };
                    continue;
                }
                if (InterruptMaskEnd.is(ir.value)) {
                    fiber.masks.unmask(ir.value.arg);
                    if (fiber.cancelRequested && fiber.masks.canInterrupt) {
                        yield* closeFiber(fiber);
                        finish(fiber);
                        break;
                    }
                    fiber.resume = { type: 'next', value: undefined };
                    continue;
                }
                fiber.resume = { type: 'next', value: yield ir.value };
            }
            if (fiber.status === 'ready')
                ready.push(fiber);
        }
        completed = true;
        if (outcome !== undefined) {
            cancelActiveFibers(fibers);
            for (const fiber of fibers) {
                if (fiber.status !== 'done') {
                    yield* closeFiber(fiber);
                    finish(fiber);
                }
            }
            const cleanupFailures = fibers.flatMap(fiber => fiber.cleanupFailures);
            if (cleanupFailures.length > 0) {
                const failures = outcome.type === 'fail'
                    ? [outcome.error, ...cleanupFailures]
                    : cleanupFailures;
                return (yield* fail(resourceReleaseFailed(failures)));
            }
            if (outcome.type === 'fail')
                return (yield* fail(outcome.error));
            return outcome.value;
        }
        return state;
    }
    finally {
        if (!completed) {
            cancelActiveFibers(fibers);
            for (const fiber of fibers) {
                if (fiber.status !== 'done') {
                    yield* closeFiber(fiber);
                    finish(fiber);
                }
            }
        }
    }
});
const emptyOutcome = (policy, state, size) => {
    if (size !== 0)
        return undefined;
    const decision = policy.onEmpty?.(state);
    return decision?.type === 'continue' ? undefined : decision;
};
const groupKind = (group) => group.arg.policy.tag === 'all' ? 'all' : 'race';
const childFrameKind = (trace) => trace?.frame.kind === 'all' || trace?.frame.kind === 'race' ? trace.frame.kind : 'fork';
const groupPolicy = (policy) => {
    if (policy === allPolicy)
        return allGroupPolicy();
    if (policy === firstSettledPolicy)
        return raceGroupPolicy();
    if (policy === firstSuccessPolicy)
        return firstSuccessGroupPolicy();
    throw new TypeError('Unknown concurrency policy');
};
const allGroupPolicy = () => ({
    init: size => ({ results: sparseArray(size), completed: 0 }),
    onEmpty: state => ({ type: 'succeed', state, value: state.results, cancelRest: false }),
    onSuccess: (state, index, value) => {
        state.results[index] = value;
        state.completed++;
        return state.completed === state.results.length
            ? { type: 'succeed', state, value: state.results, cancelRest: false }
            : { type: 'continue', state };
    },
    onFailure: (state, _index, error) => ({ type: 'fail', state, error, cancelRest: true })
});
const raceGroupPolicy = () => ({
    init: () => undefined,
    onSuccess: (_state, _index, value) => ({ type: 'succeed', state: undefined, value, cancelRest: true }),
    onFailure: (_state, _index, error) => ({ type: 'fail', state: undefined, error, cancelRest: true })
});
const firstSuccessGroupPolicy = () => ({
    init: size => ({ size, failures: sparseArray(size) }),
    onEmpty: state => ({ type: 'fail', state, error: new RaceAllFailed(state.failures), cancelRest: false }),
    onSuccess: (state, _index, value) => ({ type: 'succeed', state, value, cancelRest: true }),
    onFailure: (state, index, error) => {
        state.failures[index] = error;
        const failed = state.failures.filter((_, i) => i in state.failures).length;
        return failed === state.size
            ? { type: 'fail', state, error: new RaceAllFailed(state.failures), cancelRest: true }
            : { type: 'continue', state };
    }
});
const sparseArray = (length) => {
    const array = [];
    array.length = length;
    return array;
};
const startCooperativeAsync = (fiber, async, wake, failFiber) => {
    const abort = new AbortController();
    fiber.abort = abort;
    fiber.status = 'waiting';
    const context = getRuntimeContext(async);
    const run = () => async.arg.run(abort.signal);
    const promise = context === undefined ? run() : withActiveRuntimeContext(context, run);
    promise.then(value => {
        if (fiber.status !== 'waiting')
            return;
        fiber.abort = undefined;
        fiber.resume = { type: 'next', value };
        fiber.status = 'ready';
        wake.ready(fiber);
    }, error => {
        if (fiber.status !== 'waiting')
            return;
        fiber.abort = undefined;
        failFiber(fiber, { error: wrapAsyncFiberError(fiber, async, error, context) });
        wake.notify();
    });
};
function* closeFiber(fiber) {
    fiber.abort?.abort();
    fiber.abort = undefined;
    let ir;
    try {
        ir = withInterpretedReturn(() => fiber.iterator.return?.() ?? { done: true, value: undefined });
    }
    catch (e) {
        fiber.cleanupFailures.push(e);
        return;
    }
    while (!ir.done) {
        try {
            if (Async.is(ir.value)) {
                ir = fiber.iterator.next(yield ir.value);
            }
            else if (Fail.is(ir.value)) {
                fiber.cleanupFailures.push(ir.value.arg);
                return;
            }
            else if (InterruptMaskBegin.is(ir.value)) {
                fiber.masks.mask(ir.value.arg);
                ir = fiber.iterator.next();
            }
            else if (InterruptMaskEnd.is(ir.value)) {
                fiber.masks.unmask(ir.value.arg);
                ir = fiber.iterator.next();
            }
            else {
                ir = fiber.iterator.next(yield ir.value);
            }
        }
        catch (e) {
            fiber.cleanupFailures.push(e);
            return;
        }
    }
}
const cancelActiveFibers = (fibers, except) => {
    for (const fiber of fibers) {
        if (fiber === except || fiber.status === 'done')
            continue;
        fiber.cancelRequested = true;
        if (fiber.masks.canInterrupt) {
            fiber.abort?.abort();
        }
    }
};
const wrapFiberFailure = (fiber, failure) => {
    const context = runtimeContextOfEffect(failure);
    const causeTrace = getTrace(failure.arg);
    const trace = traceUnhandledFail(failure, causeTrace, fiber.traceOrigin.trace, context);
    const origin = originOfUnhandledFail(failure, causeTrace);
    return new ForkError('FX_UNHANDLED_FAILURE', 'Unhandled failure in forked task', origin, trace, context, { cause: failure.arg });
};
const wrapThrownFiberError = (fiber, error) => {
    const context = runtimeContextOfEffect(error);
    return new ForkError('FX_UNHANDLED_EXCEPTION', 'Unhandled exception in forked task', fiber.traceOrigin.origin, traceWithCause(fiber.traceOrigin.trace, error, context, getTrace(error)), context, { cause: error });
};
const wrapAsyncFiberError = (fiber, async, error, fallbackContext) => {
    const context = runtimeContextOfEffect(error, fallbackContext);
    const asyncTrace = capturePrependTraceWithContext(context, async.arg.origin, fiber.traceOrigin.trace, { kind: 'async' });
    return new ForkError('FX_AWAITED_ASYNC_FAILED', 'Awaited Async task failed', async.arg.origin, traceWithCause(asyncTrace, error, context, getTrace(error)), context, { cause: error });
};
const childTraceOriginWithContext = (context, parent, index, kind) => {
    const origin = indexed(parent.origin, index);
    return { origin, trace: captureTraceWithContext(context, origin, parent.trace, { kind, index }) };
};
const throwIntoMissingIterator = (error) => {
    throw error;
};
class Wake {
    readyFibers = [];
    waiters = [];
    ready(fiber) {
        this.readyFibers.push(fiber);
        this.notify();
    }
    notify() {
        const waiters = this.waiters.splice(0);
        for (const waiter of waiters)
            waiter();
    }
    wait() {
        return fx(function* () {
            if (this.readyFibers.length === 0) {
                yield* AsyncWait(this.waiters);
            }
            return this.readyFibers.splice(0);
        }.bind(this));
    }
}
const AsyncWait = (waiters) => new Async({
    run: signal => new Promise(resolve => {
        const resolveOnce = () => {
            signal.removeEventListener('abort', resolveOnce);
            resolve();
        };
        signal.addEventListener('abort', resolveOnce, { once: true });
        waiters.push(resolveOnce);
    }),
    origin: at('fx/Concurrent/withCoopConcurrency/wait', AsyncWait),
    trace: captureTrace(at('fx/Concurrent/withCoopConcurrency/wait', AsyncWait), undefined, { kind: 'async' })
});
const resourceReleaseFailed = (failures) => new AggregateError(failures, 'Resource release failed');
