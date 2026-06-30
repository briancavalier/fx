import type { Breadcrumb } from './Breadcrumb.js'
import { Fx } from './Fx.js'
import type { AnyScope } from './Scope.js'
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

export interface EffectInstance<Id, A, R> extends AnyEffect, Pipeable {
  readonly _fxEffectId: Id
  readonly arg: A
  readonly R: R

  returning<RR extends R>(): Fx<this, RR>
  [Symbol.iterator](): Iterator<this, R, any>
}

export interface EffectClass<Id> extends EffectType {
  readonly _fxEffectId: Id
  new<A, R = unknown>(arg: A): EffectInstance<Id, A, R>
  is<E extends EffectType>(this: E, x: unknown): x is InstanceType<E>
}

type EffectOperation = (...args: readonly any[]) => unknown

type EffectArg<F extends EffectOperation> =
  Parameters<F> extends readonly [] ? void
  : Parameters<F> extends readonly [infer A] ? A
  : Readonly<Parameters<F>>

type EffectConstructor<Id, Args extends readonly unknown[], A, R> = EffectClass<Id> & {
  (...args: Args): EffectInstance<Id, A, R>
  new(...args: Args): EffectInstance<Id, A, R>
}

type EffectNamespace<Prefix extends string, Spec extends Record<string, EffectOperation>> = {
  readonly [K in keyof Spec & string]: EffectConstructor<
    `${Prefix}/${K}`,
    Parameters<Spec[K]>,
    EffectArg<Spec[K]>,
    ReturnType<Spec[K]>
  >
}

export interface ScopedEffectInstance<Id, Scope extends AnyScope, A, R> extends EffectInstance<Id, A, R> {
  readonly scope: Scope
}

export interface ScopedEffectClass<Id> extends EffectType {
  readonly _fxEffectId: Id
  new<const Scope extends AnyScope, A = void, R = unknown>(
    scope: Scope,
    arg: A
  ): ScopedEffectInstance<Id, Scope, A, R>
  is<E extends EffectType>(this: E, x: unknown): x is InstanceType<E>
}

export interface EffectOrigin {
  readonly [EffectOriginTypeId]: TraceOrigin
}

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
export const Effect = <const T extends string>(id: T): EffectClass<T> => class <A, R = unknown> implements EffectInstance<T, A, R> {
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
} as EffectClass<T>

/**
 * Define a namespace of effect request constructors from operation signatures.
 *
 * Each property name becomes an effect id segment under `prefix`. Operation
 * parameters become the request argument stored in `arg`, and the operation
 * return type is the answer received by `yield*`.
 *
 * @example
 * ```ts
 * const UserEffects = effects('app/User')<{
 *   readonly find: (id: string) => User | undefined
 *   readonly save: (user: User, overwrite: boolean) => User
 * }>()
 *
 * const user = yield* UserEffects.find('user-1')
 * ```
 */
export const effects = <const Prefix extends string>(prefix: Prefix) =>
  <Spec extends Record<string, EffectOperation>>(): EffectNamespace<Prefix, Spec> => {
    const constructors = new Map<string, EffectClass<string>>()

    return new Proxy({}, {
      get(_, key) {
        if (typeof key !== 'string') return undefined

        let Type = constructors.get(key)
        if (Type === undefined) {
          Type = effectConstructor(`${prefix}/${key}`)
          constructors.set(key, Type)
        }

        return Type
      }
    }) as EffectNamespace<Prefix, Spec>
  }

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
 *   extends ScopedEffect('app/Stop')<Scope, void, never> { }
 *
 * const stop = <const S extends Scope>(scope: S) =>
 *   new Stop(scope, undefined)
 * ```
 */
export const ScopedEffect = <const T extends string>(id: T) => class <
  const Scope extends AnyScope,
  A = void,
  R = unknown
> extends Effect(id)<A, R> implements ScopedEffectInstance<T, Scope, A, R> {
  constructor(public readonly scope: Scope, arg: A) {
    super(arg)
  }
} as ScopedEffectClass<T>

const effectConstructor = (id: string): EffectClass<string> => {
  const Type = Effect(id)
  const Constructor = function (this: unknown, ...args: readonly unknown[]) {
    return new Type(args.length === 0 ? undefined : args.length === 1 ? args[0] : args)
  }

  Object.setPrototypeOf(Constructor, Type)

  return Constructor as unknown as EffectClass<string>
}

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
