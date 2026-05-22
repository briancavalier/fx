import { captureTrace } from './Trace.js';
import { Once } from './internal/generator.js';
import { pipeThis } from './internal/pipe.js';
export const EffectTypeId = Symbol('fx/Effect');
export const EffectOriginTypeId = Symbol('fx/Effect/origin');
/**
 * Define an effect type with a stable string identity.
 *
 * Extend the returned class to describe one kind of request. The first type
 * parameter is the request argument stored in `arg`; the second is the answer
 * type received by `yield*`.
 *
 * @example
 * ```ts
 * class FindUser extends Effect('app/User/Find')<string, User | undefined> { }
 *
 * const findUser = (id: string) => new FindUser(id)
 *
 * const user = yield* findUser('user-1')
 * ```
 */
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
/**
 * Define an effect type whose requests are associated with a named scope.
 *
 * Scoped effects let handlers interpret only requests from a matching scope.
 * Use them when a request should be local to a resource, region, or control
 * boundary.
 *
 * @example
 * ```ts
 * class Stop<const Scope extends string>
 *   extends ScopedEffect('app/Stop')<Scope, void, never> { }
 *
 * const stop = <const Scope extends string>(scope: Scope) =>
 *   new Stop(scope, undefined)
 * ```
 */
export const ScopedEffect = (id) => class extends Effect(id) {
    scope;
    constructor(scope, arg) {
        super(arg);
        this.scope = scope;
    }
};
export const isEffect = (e) => !!e && e._fxTypeId === EffectTypeId;
/**
 * Attach diagnostic origin information to an effect request.
 *
 * Runtime handlers use this metadata to preserve request-site traces when an
 * interpretation fails later at an async or platform boundary.
 */
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
