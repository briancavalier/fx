import { ScopedEffect } from './Effect.js'
import { Fx, map, ok } from './Fx.js'
import { handleScoped } from './Handler.js'

declare const YieldingTypeId: unique symbol

export type Yielding<Protocol extends PropertyKey, Out, In = void> = {
  readonly [YieldingTypeId]: {
    readonly [P in Protocol]: {
      readonly out: Out
      readonly in: In
    }
  }
}

export const yieldScope =
  <Out, In = void>() =>
    <const Scope extends string>(scope: Scope): Scope & Yielding<Scope, Out, In> =>
      scope as Scope & Yielding<Scope, Out, In>

export type YieldOutput<Scope> =
  YieldProtocolOutput<YieldProtocolValue<Scope>>

export type YieldInput<Scope> =
  YieldProtocolInput<YieldProtocolValue<Scope>> extends (input: infer In) => void ? In : never

type AnyYielding = { readonly [YieldingTypeId]: object }

/**
 * Yield a value to the named scope.
 */
export class YieldFrom<
  const Scope extends string & AnyYielding
> extends ScopedEffect('fx/YieldFrom')<Scope, YieldOutput<Scope>, YieldInput<Scope>> { }

/**
 * Yield a value to the named scope.
 */
export const yieldFrom = <const Scope extends string & AnyYielding>(
  scope: Scope,
  value: YieldOutput<Scope>
): YieldFrom<Scope> =>
  new YieldFrom(scope, value)

export type YieldValue<E, Scope extends string & AnyYielding> =
  E extends YieldFrom<Scope> ? YieldOutput<Scope> : never

export type ExcludeYieldFrom<E, Scope extends string & AnyYielding, E2 = never> =
  E extends YieldFrom<Scope> ? E2 : E

/**
 * Collect all one-way yields from the named scope.
 */
export const collectFrom = <const Scope extends string & AnyYielding>(
  scope: YieldInput<Scope> extends void ? Scope : never
) =>
  <const E, const A>(
    f: Fx<E, A>
  ): Fx<ExcludeYieldFrom<E, Scope>, readonly [A, readonly YieldValue<E, Scope>[]]> => {
    const values = [] as YieldValue<E, Scope>[]

    return f.pipe(
      handleScoped(YieldFrom<Scope>, scope, effect =>
        ok(void values.push(effect.arg as YieldValue<E, Scope>) as YieldInput<Scope>)),
      map(result => [result, values] as const)
    ) as Fx<ExcludeYieldFrom<E, Scope>, readonly [A, readonly YieldValue<E, Scope>[]]>
  }

type YieldProtocols<Scope> =
  Scope extends { readonly [YieldingTypeId]: infer Protocols } ? Protocols : never

type YieldProtocolValue<Scope> =
  YieldProtocols<Scope>[keyof YieldProtocols<Scope>]

type YieldProtocolOutput<Protocol> =
  Protocol extends { readonly out: infer Out } ? Out : never

type YieldProtocolInput<Protocol> =
  Protocol extends { readonly in: infer In } ? (input: In) => void : never
