import { isEffect } from '../Effect.js';
import { getTraceCapturePolicy } from './tracePolicy.js';
import { pipeThis } from './pipe.js';
export const RuntimeContextTypeId = Symbol('fx/RuntimeContext');
let activeRuntimeContext;
export const currentRuntimeContext = () => activeRuntimeContext;
export const withActiveRuntimeContext = (context, f) => {
    const previous = activeRuntimeContext;
    activeRuntimeContext = previous === undefined
        ? context
        : mergeRuntimeContext(previous, context);
    try {
        return f();
    }
    finally {
        activeRuntimeContext = previous;
    }
};
export const withRuntimeContext = (context, fx) => context === undefined ? fx : new RuntimeContextFx(fx, context);
export const attachRuntimeContext = (target, context = activeRuntimeContext) => {
    if (context === undefined || typeof target !== 'object' || target === null)
        return;
    if (target[RuntimeContextTypeId] !== undefined)
        return;
    try {
        Object.defineProperty(target, RuntimeContextTypeId, {
            value: context,
            enumerable: false,
            writable: false,
            configurable: true
        });
    }
    catch {
        // Preserve the original thrown value if runtime metadata cannot be attached.
    }
};
export const getRuntimeContext = (target) => typeof target === 'object' && target !== null
    ? target[RuntimeContextTypeId]
    : undefined;
export const traceCapturePolicy = (context = activeRuntimeContext) => context?.traceCapturePolicy ?? getTraceCapturePolicy();
export const capturesTrace = (context) => traceCapturePolicy(context) !== 'off';
export const capturesStack = (context) => traceCapturePolicy(context) === 'full';
export const activeScopes = (context = activeRuntimeContext) => context?.activeScopes ?? [];
export const interruptionReason = (context = activeRuntimeContext) => context?.interruptionReason;
export const withInterruptionReason = (context, reason) => reason === undefined ? context : { ...context, interruptionReason: reason };
export const withActiveScope = (scope, fx) => {
    const scopes = activeScopes();
    const previousScope = scopes.at(-1);
    const nextScopes = previousScope?.id === scope.id
        ? scopes
        : [...scopes, scope];
    return withRuntimeContext({ activeScopes: nextScopes }, fx);
};
const mergeRuntimeContext = (previous, next) => ({
    ...previous,
    ...next
});
class RuntimeContextFx {
    fx;
    context;
    pipe = pipeThis;
    constructor(fx, context) {
        this.fx = fx;
        this.context = context;
    }
    [Symbol.iterator]() {
        const iterator = withActiveRuntimeContext(this.context, () => this.fx[Symbol.iterator]());
        return new RuntimeContextIterator(iterator, this.context);
    }
}
class RuntimeContextIterator {
    iterator;
    context;
    constructor(iterator, context) {
        this.iterator = iterator;
        this.context = context;
    }
    next(value) {
        return this.run(() => this.iterator.next(value));
    }
    return(value) {
        return this.run(() => this.iterator.return?.(value) ?? { done: true, value: value });
    }
    throw(error) {
        return this.run(() => {
            if (this.iterator.throw === undefined)
                throw error;
            return this.iterator.throw(error);
        });
    }
    run(f) {
        return withActiveRuntimeContext(this.context, () => {
            try {
                const result = f();
                if (!result.done && isEffect(result.value))
                    attachRuntimeContext(result.value);
                return result;
            }
            catch (e) {
                attachRuntimeContext(e);
                throw e;
            }
        });
    }
}
