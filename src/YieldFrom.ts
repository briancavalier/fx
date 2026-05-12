import { Effect } from './Effect.js'
import { Fx, map, ok } from './Fx.js'
import { handle } from './Handler.js'

declare const YieldingTypeId: unique symbol

export type Yielding<Out, In = void> = {
  readonly [YieldingTypeId]: {
    readonly out: Out
    readonly in: In
  }
}

export const brand = <Brand>() =>
  <const Name extends string>(name: Name): Name & Brand =>
    name as Name & Brand

export type YieldOutput<Scope> =
  Scope extends Yielding<infer Out, unknown> ? Out : never

export type YieldInput<Scope> =
  Scope extends Yielding<unknown, infer In> ? In : never

/**
 * Yield a value to the named scope.
 */
export class YieldFrom<
  const Scope extends string & Yielding<unknown, unknown>
> extends Effect('fx/YieldFrom')<{
  readonly scope: Scope
  readonly value: YieldOutput<Scope>
}, YieldInput<Scope>> { }

/**
 * Yield a value to the named scope.
 */
export const yieldFrom = <const Scope extends string & Yielding<unknown, unknown>>(
  scope: Scope,
  value: YieldOutput<Scope>
): YieldFrom<Scope> =>
  new YieldFrom({ scope, value })

export type YieldValue<E, Scope extends string & Yielding<unknown, unknown>> =
  E extends YieldFrom<Scope> ? YieldOutput<Scope> : never

export type ExcludeYieldFrom<E, Scope extends string & Yielding<unknown, unknown>, E2 = never> =
  E extends YieldFrom<Scope> ? E2 : E

/**
 * Handle yields from the named scope.
 */
export const handleYieldFrom = <const Scope extends string & Yielding<unknown, unknown>, const E2>(
  scope: Scope,
  handler: (value: YieldOutput<Scope>, effect: YieldFrom<Scope>) => Fx<E2, YieldInput<Scope>>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ExcludeYieldFrom<E, Scope, E2>, A> =>
    f.pipe(handle<typeof YieldFrom, E2 | YieldFrom<string & Yielding<unknown, unknown>>>(YieldFrom, effect => {
      if (effect.arg.scope === scope) {
        return handler(
          effect.arg.value as YieldOutput<Scope>,
          effect as YieldFrom<Scope>
        )
      }

      return effect as YieldFrom<string & Yielding<unknown, unknown>>
    })) as Fx<ExcludeYieldFrom<E, Scope, E2>, A>

/**
 * Collect all one-way yields from the named scope.
 */
export const collectFrom = <const Scope extends string & Yielding<unknown, void>>(scope: Scope) =>
  <const E, const A>(
    f: Fx<E, A>
  ): Fx<ExcludeYieldFrom<E, Scope>, readonly [A, readonly YieldValue<E, Scope>[]]> => {
    const values = [] as YieldValue<E, Scope>[]

    return f.pipe(
      handleYieldFrom(scope, value => ok(void values.push(value as YieldValue<E, Scope>) as YieldInput<Scope>)),
      map(result => [result, values] as const)
    ) as Fx<ExcludeYieldFrom<E, Scope>, readonly [A, readonly YieldValue<E, Scope>[]]>
  }
