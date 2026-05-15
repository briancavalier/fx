import { ScopedEffect } from './Effect.js'
import { Fx, ok } from './Fx.js'
import { control } from './Handler.js'

/**
 * Abort the named scope without returning a result.
 */
export class Abort<const Scope extends string> extends ScopedEffect('fx/Abort')<Scope, void, never> { }

export const abort = <const Scope extends string>(scope: Scope): Fx<Abort<Scope>, never> =>
  new Abort(scope, undefined)

/**
 * Return a default value from an abort of the named scope.
 */
export const orReturn = <const Scope extends string, const R>(
  scope: Scope,
  value: R
) => <const E, const A>(
  f: Fx<E, A>
): Fx<Exclude<E, Abort<Scope>>, A | R> =>
    f.pipe(
      control(Abort, (_, abort) =>
        (abort.scope === scope ? ok(value) : abort) as Fx<Exclude<E, Abort<Scope>>, A | R>)
    ) as Fx<Exclude<E, Abort<Scope>>, A | R>
