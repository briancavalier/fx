import { at } from './Breadcrumb.js'
import { ScopedEffect, withOrigin } from './Effect.js'
import { Fx, fx, ok } from './Fx.js'
import { control } from './Handler.js'
import { withScope, type AnyScope, type ReturnValue, type ScopeEffects } from './Scope.js'

/**
 * Abort the named scope without returning a result.
 */
export class Abort<const Scope extends AnyScope> extends ScopedEffect('fx/Abort')<Scope, void, never> { }

export const abort = <const Scope extends AnyScope>(scope: Scope): Fx<Abort<Scope>, never> =>
  withOrigin(new Abort(scope, undefined), at('fx/Abort/abort', abort))

/**
 * Return a default value from an abort of the named scope.
 */
export const orReturn = <const Scope extends AnyScope, const R>(
  scope: Scope,
  value: R
) => <const E, const A>(
  f: Fx<E, A>
): Fx<Exclude<E, Abort<Scope>>, A | R> =>
    f.pipe(
      control(Abort, (_, abort) =>
        (abort.scope.name === scope.name ? ok(value) : abort) as Fx<Exclude<E, Abort<Scope>>, A | R>)
    ) as Fx<Exclude<E, Abort<Scope>>, A | R>

export interface RestartOnAbortOptions {
  /**
   * Number of restarts after the initial attempt.
   */
  readonly restarts: number
}

const Restart = Symbol('fx/Abort/restartOnAbort')

/**
 * Restart a scoped computation when it aborts the named scope.
 */
export const restartOnAbort = <const Scope extends AnyScope>(
  scope: Scope,
  options: RestartOnAbortOptions
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ScopeEffects<E, Scope> | Abort<Scope>, A | ReturnValue<E, Scope>> =>
  fx(function* () {
    let restarts = 0
    let aborted: Abort<Scope> | undefined
    const attempt = f.pipe(
      withScope(scope),
      control(Abort, (_, abort) => {
        if (abort.scope.name !== scope.name) return abort

        aborted = abort as Abort<Scope>
        return ok(Restart)
      })
    )

    while (true) {
      const result = yield* attempt
      if (result !== Restart) return result as A | ReturnValue<E, Scope>

      if (restarts >= options.restarts) return yield* aborted!

      restarts += 1
    }
  }) as Fx<ScopeEffects<E, Scope> | Abort<Scope>, A | ReturnValue<E, Scope>>
