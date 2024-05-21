import { Fx } from './Fx'
import { Once } from './internal/generator'
import { Pipeable, pipe } from './internal/pipe'

export interface EffectType {
  readonly _fxEffectId: unknown
  new(...args: readonly any[]): any
}

export const EffectTypeId = Symbol('fx/Effect')

export interface AnyEffect {
  readonly _fxTypeId: typeof EffectTypeId
  readonly _fxEffectId: unknown
  readonly arg: unknown
}

export const Effect = <const T extends string>(id: T) => class <A, R = unknown> implements AnyEffect, Pipeable {
  public readonly _fxTypeId: typeof EffectTypeId = EffectTypeId;
  public readonly _fxEffectId = id;
  public static readonly _fxEffectId = id;
  public readonly R!: R

  constructor(public readonly arg: A) { }

  returning<RR extends R>() { return this as Fx<this, RR> }

  pipe() { return pipe(this, arguments) }

  [Symbol.iterator](): Iterator<this, R, any> {
    return new Once<this, R>(this)
  }
}

export const isEffect = <E>(e: E): e is E & AnyEffect =>
  !!e && (e as any)._fxTypeId === EffectTypeId

export const is = <const E extends EffectType>(e: E, x: unknown): x is InstanceType<E> =>
  !!x && (x as any)._fxEffectId === e._fxEffectId
