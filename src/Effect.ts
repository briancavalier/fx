import type { Breadcrumb } from './Breadcrumb.js'
import { Fx } from './Fx.js'
import type { AnyScope } from './Scope.js'
import { captureTrace } from './Trace.js'
import type { Trace, TraceOrigin } from './Trace.js'
import { Once } from './internal/generator.js'
import { Pipeable, pipeThis } from './internal/pipe.js'

export interface EffectType {
  readonly _fxEffectId: unknown
  new(...args: any[]): any
}

export const EffectTypeId = Symbol('fx/Effect')
export const EffectOriginTypeId = Symbol('fx/Effect/origin')

export interface AnyEffect {
  readonly _fxTypeId: typeof EffectTypeId
  readonly _fxEffectId: unknown
  readonly arg: unknown
}

export interface EffectInstance<Id, A, R> extends AnyEffect, Pipeable {
  readonly _fxEffectId: Id
  readonly arg: A
  readonly R: R

  returning<RR extends R>(): Fx<this, RR>
  [Symbol.iterator](): Iterator<this, R, any>
}

export interface EffectClass<Id> extends EffectType {
  readonly _fxEffectId: Id
  new<Args extends EffectArgs = [], R = unknown>(...args: Args): EffectInstance<Id, EffectArg<Args>, R>
  of<E extends EffectType>(this: E, ...args: ConstructorParameters<E>): InstanceType<E>
  is<E extends EffectType>(this: E, x: unknown): x is InstanceType<E>
}

export interface ScopedEffectInstance<Id, Scope extends AnyScope, A, R> extends EffectInstance<Id, A, R> {
  readonly scope: Scope
}

export interface ScopedEffectClass<Id> extends EffectType {
  readonly _fxEffectId: Id
  new<const Scope extends AnyScope, Args extends EffectArgs = [], R = unknown>(
    scope: Scope,
    ...args: Args
  ): ScopedEffectInstance<Id, Scope, EffectArg<Args>, R>
  of<E extends EffectType>(this: E, ...args: ConstructorParameters<E>): InstanceType<E>
  is<E extends EffectType>(this: E, x: unknown): x is InstanceType<E>
}

export interface EffectOrigin {
  readonly [EffectOriginTypeId]: TraceOrigin
}

/**
 * Define an effect type with a stable string identity.
 *
 * Extend the returned class to describe one kind of request. The first type
 * parameter is the tuple of constructor arguments; the second is the answer
 * type received by `yield*`. Zero arguments store `void` in `arg`, one
 * argument stores that value, and multiple arguments store a readonly tuple.
 *
 * @example
 * ```ts
 * class FindUser extends Effect('app/User/Find')<[string], User | undefined> { }
 *
 * const user = yield* FindUser.of('user-1')
 * ```
 */
export const Effect = <const T extends string>(id: T): EffectClass<T> => class <
  Args extends EffectArgs = [],
  R = unknown
> implements EffectInstance<T, EffectArg<Args>, R> {
  public readonly _fxTypeId: typeof EffectTypeId = EffectTypeId;
  public readonly _fxEffectId = id;
  public static readonly _fxEffectId = id;
  public readonly arg: EffectArg<Args>
  public readonly R!: R
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(...args: Args) {
    this.arg = effectArg(args)
  }

  static is<E extends EffectType>(this: E, x: unknown): x is InstanceType<E> {
    return !!x && (x as any)._fxEffectId === this._fxEffectId
  }

  static of<E extends EffectType>(this: E, ...args: ConstructorParameters<E>): InstanceType<E> {
    return new this(...args)
  }

  returning<RR extends R>() { return this as Fx<this, RR> }

  [Symbol.iterator](): Iterator<this, R, any> {
    return new Once<this, R>(this)
  }
} as EffectClass<T>

/**
 * Define an effect type whose requests are associated with a named scope.
 *
 * Scoped effects let handlers interpret only requests from a matching scope.
 * Use them when a request should be local to a resource, region, or control
 * boundary.
 *
 * @example
 * ```ts
 * class Stop<const S extends Scope>
 *   extends ScopedEffect('app/Stop')<Scope, [], never> { }
 *
 * const stop = <const S extends Scope>(scope: S) =>
 *   new Stop(scope)
 * ```
 */
export const ScopedEffect = <const T extends string>(id: T) => class <
  const Scope extends AnyScope,
  Args extends EffectArgs = [],
  R = unknown
> extends Effect(id)<Args, R> implements ScopedEffectInstance<T, Scope, EffectArg<Args>, R> {
  constructor(public readonly scope: Scope, ...args: Args) {
    super(...args)
  }
} as ScopedEffectClass<T>

export const isEffect = <E>(e: E): e is E & AnyEffect =>
  !!e && (e as any)._fxTypeId === EffectTypeId

/**
 * Attach diagnostic origin information to an effect request.
 *
 * Runtime handlers use this metadata to preserve request-site traces when an
 * interpretation fails later at an async or platform boundary.
 */
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

type EffectArgs = readonly unknown[]

type EffectArg<Args extends EffectArgs> =
  Args extends readonly [] ? void :
  Args extends readonly [infer A] ? A :
  Readonly<Args>

const effectArg = <Args extends EffectArgs>(args: Args): EffectArg<Args> =>
  (args.length === 0 ? undefined : args.length === 1 ? args[0] : args) as EffectArg<Args>
