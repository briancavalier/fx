import { Async } from '../Async.js';
import { at } from '../Breadcrumb.js';
import { Fail } from '../Fail.js';
import { Fork } from '../Concurrent.js';
import { HandlerCapture, withHandlerContext } from '../HandlerCapture.js';
import { Task } from '../Task.js';
import { attachTrace, captureAppendTrace, capturePrependTrace, captureTrace, getTrace } from '../Trace.js';
import { Semaphore } from './Semaphore.js';
import { DisposableSet } from './disposable.js';
import { InterruptMaskBegin, InterruptMaskEnd, InterruptMaskState } from './interrupt.js';
import { withInterpretedReturn } from './iteratorClose.js';
import { currentRuntimeContext, getRuntimeContext, traceCapturePolicy, withActiveRuntimeContext } from './runtimeContext.js';
export const runFork = (f, options = {}) => {
    const disposables = new InterruptState();
    const disposed = Promise.withResolvers();
    const runtimeContext = currentRuntimeContext();
    const origin = options.origin ?? at('fx/runFork', runFork);
    const trace = options.trace ?? captureTraceWithContext(runtimeContext, origin, undefined, { kind: 'run' });
    const maxConcurrency = options.maxConcurrency ?? Infinity;
    const promise = runForkInternal(f, [], new Semaphore(maxConcurrency), disposables, disposed, origin, trace, runtimeContext)
        .finally(() => {
        disposables.disposeActive();
        disposed.resolve();
    });
    return taskWithRuntimeContext(promise, disposables, runtimeContext, disposed.promise);
};
export const acquireAndRunFork = (f, s, context = [], runtimeContext = currentRuntimeContext()) => {
    const disposables = new InterruptState();
    const disposed = Promise.withResolvers();
    const promise = acquire(s, disposables, disposed, () => runForkInternal(withHandlerContext(context, f.fx), context, s, disposables, disposed, f.origin, f.trace, runtimeContext)
        .finally(() => {
        disposables.disposeActive();
        disposed.resolve();
    }));
    return taskWithRuntimeContext(promise, disposables, runtimeContext, disposed.promise);
};
const runForkInternal = (f, context, semaphore, disposables, disposed, origin, trace, runtimeContext) => {
    let rejectUnhandled = () => { };
    const unhandled = new Promise((_, reject) => {
        rejectUnhandled = reject;
    });
    unhandled.catch(() => { });
    return runForkLoop(f, context, semaphore, disposables, disposed, origin, trace, unhandled, e => rejectUnhandled(new UnhandledForkError(e)), runtimeContext);
};
const runForkLoop = async (f, context, semaphore, disposables, disposed, origin, trace, unhandled, rejectUnhandled, runtimeContext) => {
    let interrupting;
    try {
        const i = iteratorWithRuntimeContext(f, runtimeContext);
        const interrupt = async (cleanupMasks = disposables.maskSnapshot()) => {
            if (interrupting === undefined) {
                interrupting = closeInterruptedIterator(i, context, semaphore, origin, trace, unhandled, rejectUnhandled, runtimeContext, disposed, cleanupMasks);
                interrupting.catch(() => { });
            }
            await interrupting;
            return await never();
        };
        disposables.setInterrupt(interrupt);
        return await runIterator(nextWithRuntimeContext(i, runtimeContext), i, context, semaphore, disposables, origin, trace, unhandled, rejectUnhandled, runtimeContext, interrupt);
    }
    catch (e) {
        if (e instanceof ForkError) {
            if (disposables.interruptRequested)
                disposed.reject(e);
            throw e;
        }
        const errorContext = getRuntimeContext(e) ?? runtimeContext;
        const error = new ForkError('FX_UNHANDLED_EXCEPTION', `Unhandled exception in forked task`, origin, traceWithCause(trace, e, errorContext), errorContext, { cause: e });
        if (disposables.interruptRequested)
            disposed.reject(error);
        throw error;
    }
};
const closeInterruptedIterator = async (i, context, semaphore, origin, trace, unhandled, rejectUnhandled, runtimeContext, disposed, cleanupMasks) => {
    const cleanup = new InterruptState(cleanupMasks);
    try {
        const ir = returnWithRuntimeContext(i, runtimeContext);
        await runIterator(ir, i, context, semaphore, cleanup, origin, trace, unhandled, rejectUnhandled, runtimeContext);
        disposed.resolve();
    }
    catch (e) {
        disposed.reject(e);
        throw e;
    }
    finally {
        cleanup.disposeActive();
    }
};
const runIterator = async (ir, i, context, semaphore, disposables, origin, trace, unhandled, rejectUnhandled, runtimeContext, interrupt) => {
    while (!ir.done) {
        if (Async.is(ir.value)) {
            const effectContext = runtimeContextOfEffect(ir.value, runtimeContext);
            const { run, origin } = ir.value.arg;
            const t = runTask(run, effectContext);
            disposables.add(t);
            const promise = t.promise.finally(() => disposables.remove(t));
            let a;
            try {
                a = await Promise.race([promise, unhandled]);
            }
            catch (e) {
                if (e instanceof UnhandledForkError)
                    throw e.error;
                if (disposables.canInterrupt && interrupt !== undefined)
                    return await disposables.interruptNow(interrupt);
                const asyncTrace = capturePrependTraceWithContext(effectContext, origin, trace, { kind: 'async' });
                throw new ForkError('FX_AWAITED_ASYNC_FAILED', `Awaited Async task failed`, origin, traceWithCause(asyncTrace, e, effectContext), effectContext, { cause: e });
            }
            // stop if the scope was disposed while we were waiting
            if (disposables.canInterrupt && interrupt !== undefined)
                return await disposables.interruptNow(interrupt);
            ir = resumeWithRuntimeContext(i, effectContext, a);
        }
        else if (Fork.is(ir.value)) {
            const effectContext = runtimeContextOfEffect(ir.value, runtimeContext);
            const forkOrigin = ir.value.arg.origin;
            const forkTrace = capturePrependTraceWithContext(effectContext, forkOrigin, trace, forkFrameMetadata(ir.value.arg.trace));
            const t = acquireAndRunFork({ ...ir.value.arg, trace: forkTrace }, semaphore, context, effectContext);
            disposables.add(t);
            t.promise
                .finally(() => disposables.remove(t))
                .catch(e => {
                queueMicrotask(() => {
                    if (t._handled || t._disposed || disposables.interruptRequested)
                        return;
                    rejectUnhandled(new ForkError('FX_UNHANDLED_FORK_FAILURE', `Unhandled failure in forked task`, forkOrigin, traceWithCause(forkTrace, e, effectContext), effectContext, { cause: e }));
                });
            });
            ir = resumeWithRuntimeContext(i, effectContext, t);
        }
        else if (HandlerCapture.is(ir.value)) {
            ir = resumeWithRuntimeContext(i, runtimeContext, context);
        }
        else if (InterruptMaskBegin.is(ir.value)) {
            disposables.mask(ir.value.arg);
            ir = resumeWithRuntimeContext(i, runtimeContext, undefined);
        }
        else if (InterruptMaskEnd.is(ir.value)) {
            const masksAtInterruptDelivery = disposables.maskSnapshot();
            disposables.unmask(ir.value.arg);
            if (disposables.canInterrupt && interrupt !== undefined)
                return await disposables.interruptNow(interrupt, masksAtInterruptDelivery);
            ir = resumeWithRuntimeContext(i, runtimeContext, undefined);
        }
        else if (Fail.is(ir.value)) {
            const causeTrace = getTrace(ir.value.arg);
            const effectContext = runtimeContextOfEffect(ir.value, runtimeContext);
            const failTrace = traceUnhandledFail(ir.value, causeTrace, trace, effectContext);
            const failOrigin = originOfUnhandledFail(ir.value, causeTrace);
            throw new ForkError('FX_UNHANDLED_FAILURE', `Unhandled failure in forked task`, failOrigin, failTrace, effectContext, { cause: ir.value.arg });
        }
        else {
            const effectContext = runtimeContextOfEffect(ir.value, runtimeContext);
            throw new ForkError('FX_UNHANDLED_FAILURE', `Unhandled failure in forked task`, origin, traceWithCause(trace, ir.value, effectContext), effectContext, { cause: ir.value });
        }
    }
    return ir.value;
};
class InterruptState {
    disposables = new DisposableSet();
    masks;
    interrupt;
    interrupting;
    requested = false;
    constructor(masks = []) {
        this.masks = new InterruptMaskState(masks);
    }
    get interruptRequested() {
        return this.requested;
    }
    get canInterrupt() {
        return this.requested && this.masks.canInterrupt;
    }
    setInterrupt(interrupt) {
        this.interrupt = interrupt;
        if (this.requested && this.masks.canInterrupt)
            void this.interruptNow(interrupt).catch(() => { });
    }
    add(disposable) {
        this.disposables.add(disposable);
    }
    remove(disposable) {
        this.disposables.remove(disposable);
    }
    maskSnapshot() {
        return this.masks.snapshot();
    }
    mask(token) {
        this.masks.mask(token);
    }
    unmask(token) {
        this.masks.unmask(token);
    }
    [Symbol.dispose]() {
        this.requested = true;
        if (!this.masks.canInterrupt)
            return;
        this.disposeActive();
        if (this.interrupt !== undefined)
            void this.interruptNow(this.interrupt).catch(() => { });
    }
    disposeActive() {
        this.disposables[Symbol.dispose]();
    }
    async interruptNow(interrupt, masks = this.maskSnapshot()) {
        this.disposeActive();
        this.interrupting ??= interrupt(masks);
        return await this.interrupting;
    }
}
class ForkError extends Error {
    code;
    constructor(code, message, origin, trace, runtimeContext, options) {
        super(message, options);
        this.code = code;
        if (traceCapturePolicy(runtimeContext) === 'full' && 'stack' in origin)
            Object.defineProperty(this, 'stack', { get: () => origin.stack });
        Object.defineProperty(this, 'code', {
            value: code,
            enumerable: false,
            writable: false,
            configurable: true
        });
        if (trace !== undefined)
            attachTrace(this, trace);
    }
}
class UnhandledForkError extends Error {
    error;
    constructor(error) {
        super('Unhandled fork failed');
        this.error = error;
    }
}
const acquire = async (s, scope, disposed, f) => {
    const a = s.acquire();
    const cancelled = Promise.withResolvers();
    let acquired = false;
    let released = false;
    const releaseOnce = () => {
        if (released)
            return;
        released = true;
        s.release();
    };
    const acquisition = {
        [Symbol.dispose]() {
            a[Symbol.dispose]();
            cancelled.resolve();
        }
    };
    scope.add(acquisition);
    await Promise.race([
        a.promise.then(() => {
            acquired = true;
        }),
        cancelled.promise
    ]);
    scope.remove(acquisition);
    if (!acquired) {
        disposed.resolve();
        return await never();
    }
    const interrupted = disposed.promise.then(() => {
        releaseOnce();
        return never();
    });
    try {
        return await Promise.race([f(), interrupted]);
    }
    finally {
        releaseOnce();
    }
};
const runTask = (run, runtimeContext) => {
    const s = new DisposableAbortController();
    try {
        return runtimeContext === undefined
            ? new Task(run(s.signal), s, runtimeContext)
            : withActiveRuntimeContext(runtimeContext, () => new Task(run(s.signal), s, runtimeContext));
    }
    catch (e) {
        s[Symbol.dispose]();
        return taskWithRuntimeContext(Promise.reject(e), s, runtimeContext);
    }
};
const taskWithRuntimeContext = (promise, dispose, runtimeContext, disposed) => runtimeContext === undefined
    ? new Task(promise, dispose, runtimeContext, disposed)
    : withActiveRuntimeContext(runtimeContext, () => new Task(promise, dispose, runtimeContext, disposed));
const iteratorWithRuntimeContext = (f, runtimeContext) => runtimeContext === undefined
    ? f[Symbol.iterator]()
    : withActiveRuntimeContext(runtimeContext, () => f[Symbol.iterator]());
const nextWithRuntimeContext = (iterator, runtimeContext) => runtimeContext === undefined
    ? iterator.next()
    : withActiveRuntimeContext(runtimeContext, () => iterator.next());
const resumeWithRuntimeContext = (iterator, runtimeContext, value) => runtimeContext === undefined
    ? iterator.next(value)
    : withActiveRuntimeContext(runtimeContext, () => iterator.next(value));
const returnWithRuntimeContext = (iterator, runtimeContext) => runtimeContext === undefined
    ? withInterpretedReturn(() => iterator.return?.() ?? { done: true, value: undefined })
    : withActiveRuntimeContext(runtimeContext, () => withInterpretedReturn(() => iterator.return?.() ?? { done: true, value: undefined }));
const never = () => new Promise(() => { });
const traceWithCause = (trace, cause, runtimeContext) => {
    const causeTrace = getTrace(cause);
    return captureAppendTraceWithContext(runtimeContext, causeTrace ?? trace, causeTrace === undefined ? undefined : trace);
};
const runtimeContextOfEffect = (effect, fallback) => getRuntimeContext(effect) ?? fallback;
const traceUnhandledFail = (fail, causeTrace, parentTrace, runtimeContext) => {
    if (causeTrace !== undefined)
        return captureAppendTraceWithContext(runtimeContext, causeTrace, parentTrace);
    if (fail.trace === undefined)
        return captureAppendTraceWithContext(runtimeContext, undefined, parentTrace);
    return parentTrace === undefined
        ? fail.trace
        : captureAppendTraceWithContext(runtimeContext, fail.trace, parentTrace) ?? fail.trace;
};
const originOfUnhandledFail = (fail, causeTrace) => causeTrace === undefined ? fail.origin : originFromTrace(causeTrace);
const forkFrameMetadata = (trace) => ({
    kind: trace?.frame.kind ?? 'fork',
    index: trace?.frame.index
});
const captureTraceWithContext = (context, origin, parent, metadata) => context === undefined
    ? captureTrace(origin, parent, metadata)
    : withActiveRuntimeContext(context, () => captureTrace(origin, parent, metadata));
const capturePrependTraceWithContext = (context, origin, parent, metadata) => context === undefined
    ? capturePrependTrace(origin, parent, metadata)
    : withActiveRuntimeContext(context, () => capturePrependTrace(origin, parent, metadata));
const captureAppendTraceWithContext = (context, trace, parent) => context === undefined
    ? captureAppendTrace(trace, parent)
    : withActiveRuntimeContext(context, () => captureAppendTrace(trace, parent));
const originFromTrace = (trace) => ({
    message: trace.frame.message,
    get stack() {
        return trace.frame.stackSource?.stack;
    }
});
class DisposableAbortController extends AbortController {
    [Symbol.dispose]() { this.abort(); }
}
