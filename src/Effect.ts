import type { Breadcrumb } from './Breadcrumb.js'
import { Fx } from './Fx.js'
import { captureTrace } from './Trace.js'
import type { Trace, TraceOrigin } from './Trace.js'
import { Once } from './internal/generator.js'
import { Pipeable, pipeThis } from './internal/pipe.js'

export interface EffectType {
  readonly _fxEffectId: unknown
  new(...args: readonly any[]): any
}

export const EffectTypeId = Symbol('fx/Effect')
export const EffectOriginTypeId = Symbol('fx/Effect/origin')

export interface AnyEffect {
  readonly _fxTypeId: typeof EffectTypeId
  readonly _fxEffectId: unknown
  readonly arg: unknown
}

export interface EffectOrigin {
  readonly [EffectOriginTypeId]: TraceOrigin
}

export const Effect = <const T extends string>(id: T) => class <A, R = unknown> implements AnyEffect, Pipeable {
  public readonly _fxTypeId: typeof EffectTypeId = EffectTypeId;
  public readonly _fxEffectId = id;
  public static readonly _fxEffectId = id;
  public readonly R!: R
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(public readonly arg: A) { }

  static is<E extends EffectType>(this: E, x: unknown): x is InstanceType<E> {
    return !!x && (x as any)._fxEffectId === this._fxEffectId
  }

  returning<RR extends R>() { return this as Fx<this, RR> }

  [Symbol.iterator](): Iterator<this, R, any> {
    return new Once<this, R>(this)
  }
}

export const ScopedEffect = <const T extends string>(id: T) => class <
  const Scope extends string,
  A = void,
  R = unknown
> extends Effect(id)<A, R> {
  constructor(public readonly scope: Scope, arg: A) {
    super(arg)
  }
}

export const isEffect = <E>(e: E): e is E & AnyEffect =>
  !!e && (e as any)._fxTypeId === EffectTypeId

export const withOrigin = <E extends object>(
  effect: E,
  origin: Breadcrumb,
  trace: Trace | undefined = captureTrace(origin)
): E & EffectOrigin =>
  withTraceOrigin(effect, { origin, trace })

export const withTraceOrigin = <E extends object>(effect: E, traceOrigin: TraceOrigin): E & EffectOrigin => {
  Object.defineProperty(effect, EffectOriginTypeId, {
    value: traceOrigin,
    enumerable: false,
    writable: false,
    configurable: true
  })

  return effect as E & EffectOrigin
}

export function traceOriginOf(effect: EffectOrigin): TraceOrigin
export function traceOriginOf(effect: unknown): TraceOrigin | undefined
export function traceOriginOf(effect: unknown): TraceOrigin | undefined {
  return typeof effect === 'object' && effect !== null
    ? (effect as Partial<EffectOrigin>)[EffectOriginTypeId]
    : undefined
}

export function originOf(effect: EffectOrigin): Breadcrumb
export function originOf(effect: unknown): Breadcrumb | undefined
export function originOf(effect: unknown): Breadcrumb | undefined {
  return traceOriginOf(effect)?.origin
}
