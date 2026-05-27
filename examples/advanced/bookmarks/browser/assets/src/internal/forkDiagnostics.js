import { attachTrace, captureAppendTrace, capturePrependTrace, captureTrace } from '../Trace.js';
import { getRuntimeContext, traceCapturePolicy, withActiveRuntimeContext } from './runtimeContext.js';
export class ForkError extends Error {
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
export const runtimeContextOfEffect = (effect, fallback) => getRuntimeContext(effect) ?? fallback;
export const traceWithCause = (trace, cause, runtimeContext, causeTrace) => captureAppendTraceWithContext(runtimeContext, causeTrace ?? trace, causeTrace === undefined ? undefined : trace);
export const traceUnhandledFail = (fail, causeTrace, parentTrace, runtimeContext) => {
    if (causeTrace !== undefined)
        return captureAppendTraceWithContext(runtimeContext, causeTrace, parentTrace);
    if (fail.trace === undefined)
        return captureAppendTraceWithContext(runtimeContext, undefined, parentTrace);
    return parentTrace === undefined
        ? fail.trace
        : captureAppendTraceWithContext(runtimeContext, fail.trace, parentTrace) ?? fail.trace;
};
export const originOfUnhandledFail = (fail, causeTrace) => causeTrace === undefined ? fail.origin : originFromTrace(causeTrace);
export const forkFrameMetadata = (trace) => ({
    kind: trace?.frame.kind ?? 'fork',
    index: trace?.frame.index
});
export const captureTraceWithContext = (context, origin, parent, metadata) => context === undefined
    ? captureTrace(origin, parent, metadata)
    : withActiveRuntimeContext(context, () => captureTrace(origin, parent, metadata));
export const capturePrependTraceWithContext = (context, origin, parent, metadata) => context === undefined
    ? capturePrependTrace(origin, parent, metadata)
    : withActiveRuntimeContext(context, () => capturePrependTrace(origin, parent, metadata));
export const captureAppendTraceWithContext = (context, trace, parent) => context === undefined
    ? captureAppendTrace(trace, parent)
    : withActiveRuntimeContext(context, () => captureAppendTrace(trace, parent));
export const originFromTrace = (trace) => ({
    message: trace.frame.message,
    get stack() {
        return trace.frame.stackSource?.stack;
    }
});
