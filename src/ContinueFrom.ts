import { Effect } from './Effect.js'
import { Fx, ok } from './Fx.js'
import { control } from './Handler.js'

/**
 * Continue from the named scope without returning a result.
 */
export class ContinueFrom<const Scope extends string> extends Effect('fx/ContinueFrom')<Scope, never> { }

export const continueFrom = <const Scope extends string>(scope: Scope): Fx<ContinueFrom<Scope>, never> =>
  new ContinueFrom(scope)

/**
 * Continue from the named scope unless the condition is true.
 */
export const guardFrom = <const Scope extends string>(
  scope: Scope,
  condition: boolean
): Fx<ContinueFrom<Scope>, void> =>
    condition ? ok(undefined) : continueFrom(scope)

export interface ContinuedFrom<Scope extends string> {
  readonly type: 'continueFrom'
  readonly scope: Scope
}

export const continuedFrom = <const Scope extends string>(scope: Scope): ContinuedFrom<Scope> =>
  ({ type: 'continueFrom', scope })

export const isContinuedFrom = <const Scope extends string>(
  scope: Scope,
  value: unknown
): value is ContinuedFrom<Scope> =>
    typeof value === 'object'
    && value !== null
    && (value as Partial<ContinuedFrom<Scope>>).type === 'continueFrom'
    && (value as Partial<ContinuedFrom<Scope>>).scope === scope

/**
 * Return a marker from a continue of the named scope.
 */
export const orContinue = <const Scope extends string>(
  scope: Scope
) => <const E, const A>(
  f: Fx<E, A>
): Fx<Exclude<E, ContinueFrom<Scope>>, A | ContinuedFrom<Scope>> =>
    f.pipe(
      control(ContinueFrom, (_, effect) =>
        (effect.arg === scope ? ok(continuedFrom(scope)) : effect) as Fx<
          Exclude<E, ContinueFrom<Scope>>,
          A | ContinuedFrom<Scope>
        >)
    ) as Fx<Exclude<E, ContinueFrom<Scope>>, A | ContinuedFrom<Scope>>
