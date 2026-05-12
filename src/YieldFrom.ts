import { Effect } from './Effect.js'
import { Fx, fx, map, ok } from './Fx.js'
import { control } from './Handler.js'

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
  const Scope extends string & Yielding<unknown, unknown>,
  const Out
> extends Effect('fx/YieldFrom')<{
  readonly scope: Scope
  readonly value: Out
}, void> { }

/**
 * Yield a value to the named scope.
 */
export const yieldFrom = <const Scope extends string & Yielding<unknown, unknown>>(
  scope: Scope,
  value: YieldOutput<Scope>
): YieldFrom<Scope, YieldOutput<Scope>> =>
  new YieldFrom({ scope, value })

export type YieldValue<E, Scope extends string & Yielding<unknown, unknown>> =
  E extends YieldFrom<Scope, infer Out> ? Out : never

export type ExcludeYieldFrom<E, Scope extends string & Yielding<unknown, unknown>, E2 = never> =
  E extends YieldFrom<Scope, any> ? E2 : E

/**
 * Handle yields from the named scope.
 */
export const handleYieldFrom = <const Scope extends string & Yielding<unknown, unknown>, const E2>(
  scope: Scope,
  handler: (value: YieldOutput<Scope>, effect: YieldFrom<Scope, YieldOutput<Scope>>) => Fx<E2, void>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ExcludeYieldFrom<E, Scope, E2>, A> =>
    f.pipe(control(YieldFrom, (resume, effect) => fx(function* () {
      if (effect.arg.scope === scope) {
        yield* handler(
          effect.arg.value as YieldOutput<Scope>,
          effect as YieldFrom<Scope, YieldOutput<Scope>>
        )
        return resume(undefined)
      }

      return resume(yield effect as YieldFrom<string & Yielding<unknown, unknown>, unknown>)
    }))) as Fx<ExcludeYieldFrom<E, Scope, E2>, A>

/**
 * Collect all one-way yields from the named scope.
 */
export const collectFrom = <const Scope extends string & Yielding<unknown, unknown>>(scope: Scope) =>
  <const E, const A>(
    f: Fx<E, A>
  ): Fx<ExcludeYieldFrom<E, Scope>, readonly [A, readonly YieldValue<E, Scope>[]]> => {
    const values = [] as YieldValue<E, Scope>[]

    return f.pipe(
      handleYieldFrom(scope, value => ok(void values.push(value as YieldValue<E, Scope>))),
      map(result => [result, values] as const)
    ) as Fx<ExcludeYieldFrom<E, Scope>, readonly [A, readonly YieldValue<E, Scope>[]]>
  }
