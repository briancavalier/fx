import { captureTrace } from './Trace.js';
import { Once } from './internal/generator.js';
import { pipeThis } from './internal/pipe.js';
export const EffectTypeId = Symbol('fx/Effect');
export const EffectOriginTypeId = Symbol('fx/Effect/origin');
export const Effect = (id) => class {
    arg;
    _fxTypeId = EffectTypeId;
    _fxEffectId = id;
    static _fxEffectId = id;
    R;
    pipe = pipeThis;
    constructor(arg) {
        this.arg = arg;
    }
    static is(x) {
        return !!x && x._fxEffectId === this._fxEffectId;
    }
    returning() { return this; }
    [Symbol.iterator]() {
        return new Once(this);
    }
};
export const ScopedEffect = (id) => class extends Effect(id) {
    scope;
    constructor(scope, arg) {
        super(arg);
        this.scope = scope;
    }
};
export const isEffect = (e) => !!e && e._fxTypeId === EffectTypeId;
export const withOrigin = (effect, origin, trace = captureTrace(origin)) => withTraceOrigin(effect, { origin, trace });
export const withTraceOrigin = (effect, traceOrigin) => {
    Object.defineProperty(effect, EffectOriginTypeId, {
        value: traceOrigin,
        enumerable: false,
        writable: false,
        configurable: true
    });
    return effect;
};
export function traceOriginOf(effect) {
    return typeof effect === 'object' && effect !== null
        ? effect[EffectOriginTypeId]
        : undefined;
}
export function originOf(effect) {
    return traceOriginOf(effect)?.origin;
}
