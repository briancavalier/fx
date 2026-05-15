import { ScopedEffect } from './Effect.js'
import { Fx, map, ok } from './Fx.js'
import { handleScoped } from './Handler.js'

declare const YieldingTypeId: unique symbol

export type Yielding<Out, In = void> = {
  readonly [YieldingTypeId]: {
    readonly out: Out
    readonly in: In
  }
}

export type YieldOutput<Scope> =
  Scope extends Yielding<infer Out, unknown> ? Out : never

export type YieldInput<Scope> =
  Scope extends Yielding<unknown, infer In> ? In : never

/**
 * Yield a value to the named scope.
 */
export class YieldFrom<
  const Scope extends string & Yielding<unknown, unknown>
> extends ScopedEffect('fx/YieldFrom')<Scope, YieldOutput<Scope>, YieldInput<Scope>> { }

/**
 * Yield a value to the named scope.
 */
export const yieldFrom = <const Scope extends string & Yielding<unknown, unknown>>(
  scope: Scope,
  value: YieldOutput<Scope>
): YieldFrom<Scope> =>
  new YieldFrom(scope, value)

export type YieldValue<E, Scope extends string & Yielding<unknown, unknown>> =
  E extends YieldFrom<Scope> ? YieldOutput<Scope> : never

export type ExcludeYieldFrom<E, Scope extends string & Yielding<unknown, unknown>, E2 = never> =
  E extends YieldFrom<Scope> ? E2 : E

/**
 * Collect all one-way yields from the named scope.
 */
export const collectFrom = <const Scope extends string & Yielding<unknown, void>>(scope: Scope) =>
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
