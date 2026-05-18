import { Effect, isEffect } from './Effect.js';
import { map } from './Fx.js';
import { Handler } from './internal/Handler.js';
import { drainRuntimeIteratorReturn } from './internal/iteratorClose.js';
import { pipeThis } from './internal/pipe.js';
export class HandlerCapture extends Effect('fx/HandlerCapture') {
}
export const captureHandlers = (name) => new HandlerCapture(name);
export const withCapturedHandlers = (name, fx) => captureHandlers(name).pipe(map(context => withHandlerContext(context, fx)));
export const mapCapturedHandlers = (name, fxs) => captureHandlers(name).pipe(map(context => fxs.map(fx => withHandlerContext(context, fx))));
export const closeHandlerCapture = (name) => (fx) => new HandlerCaptureBoundary(fx, name);
export const handleCaptured = (name, e, f) => (fx) => new HandlerCaptureBoundary(new Handler(fx, e._fxEffectId, f), name);
export const withHandlerContext = (c, f) => c.reduce((f, handler) => handler.wrap(f), f);
class HandlerCaptureBoundary {
    fx;
    captureName;
    pipe = pipeThis;
    constructor(fx, captureName) {
        this.fx = fx;
        this.captureName = captureName;
    }
    *[Symbol.iterator]() {
        const i = this.fx[Symbol.iterator]();
        const { captureName } = this;
        const step = function* (ir) {
            while (!ir.done) {
                if (isEffect(ir.value)) {
                    if (ir.value._fxEffectId === HandlerCapture._fxEffectId && ir.value.arg === captureName) {
                        ir = i.next([]);
                    }
                    else {
                        ir = i.next(yield ir.value);
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
                yield* drainRuntimeIteratorReturn(i, step);
            }
        }
    }
}
