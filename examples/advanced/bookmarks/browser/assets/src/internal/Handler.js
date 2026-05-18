import { isEffect } from '../Effect.js';
import { HandlerCapture } from '../HandlerCapture.js';
import { drainIteratorReturn } from './iteratorClose.js';
import { pipeThis } from './pipe.js';
import { getRuntimeContext, withActiveRuntimeContext, withRuntimeContext } from './runtimeContext.js';
export class Handler {
    fx;
    effectId;
    handler;
    pipe = pipeThis;
    constructor(fx, effectId, handler) {
        this.fx = fx;
        this.effectId = effectId;
        this.handler = handler;
    }
    wrap(fx) {
        return new Handler(fx, this.effectId, this.handler);
    }
    *[Symbol.iterator]() {
        const { effectId, handler, fx } = this;
        const i = fx[Symbol.iterator]();
        let captured;
        const step = function* (ir) {
            while (!ir.done) {
                if (isEffect(ir.value)) {
                    const effect = ir.value;
                    if (effectId === effect._fxEffectId) {
                        const context = getRuntimeContext(effect);
                        const handled = context === undefined
                            ? handler(effect)
                            : withActiveRuntimeContext(context, () => handler(effect));
                        ir = i.next(yield* withRuntimeContext(context, handled));
                    }
                    else if (effect._fxEffectId === HandlerCapture._fxEffectId) {
                        captured ??= {
                            wrap: fx => new Handler(fx, effectId, handler)
                        };
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
            return ir.value;
        };
        let completed = false;
        try {
            const value = yield* step(i.next());
            completed = true;
            return value;
        }
        finally {
            if (!completed) {
                yield* drainIteratorReturn(i, step);
            }
        }
    }
}
export class Control {
    fx;
    effectId;
    handler;
    pipe = pipeThis;
    constructor(fx, effectId, handler) {
        this.fx = fx;
        this.effectId = effectId;
        this.handler = handler;
    }
    *[Symbol.iterator]() {
        let done = false;
        const k = (x) => {
            if (done)
                throw new Error('Handler resumed more than once');
            done = true;
            return x;
        };
        const { effectId, handler, fx } = this;
        const i = fx[Symbol.iterator]();
        const step = function* (ir) {
            while (!ir.done) {
                if (isEffect(ir.value)) {
                    const effect = ir.value;
                    if (effectId === effect._fxEffectId) {
                        const context = getRuntimeContext(effect);
                        const handled = context === undefined
                            ? handler(k, effect)
                            : withActiveRuntimeContext(context, () => handler(k, effect));
                        const hr = yield* withRuntimeContext(context, handled);
                        if (!done) {
                            yield* drainIteratorReturn(i, step);
                            return hr;
                        }
                        done = false;
                        ir = i.next(hr);
                    }
                    else {
                        ir = i.next(yield effect);
                    }
                }
                else {
                    throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`);
                }
            }
            return ir.value;
        };
        let completed = false;
        try {
            const value = yield* step(i.next());
            completed = true;
            return value;
        }
        finally {
            if (!completed) {
                yield* drainIteratorReturn(i, step);
            }
        }
    }
}
