import { at } from './Breadcrumb.js'
import { ScopedEffect, withOrigin } from './Effect.js'
import { Fx, fx, ok } from './Fx.js'
import { control } from './Handler.js'
import { assertScopeOpen, inScope, type AnyControlScope, type ReturnValue, type ScopeEffects } from './Scope.js'
import { sameScope } from './internal/scopeIdentity.js'

/**
 * Abort the named scope without returning a result.
 */
export class Abort<const Scope extends AnyControlScope> extends ScopedEffect('fx/Abort')<Scope, void, never> { }

export const abort = <const Scope extends AnyControlScope>(scope: Scope): Fx<Abort<Scope>, never> => {
  assertScopeOpen(scope)
  return withOrigin(new Abort(scope, undefined), at('fx/Abort/abort', abort))
}

/**
 * Return a default value from an abort of the named scope.
 */
export const orReturn = <const Scope extends AnyControlScope, const R>(
  scope: Scope,
  value: R
) => <const E, const A>(
  f: Fx<E, A>
): Fx<Exclude<E, Abort<Scope>>, A | R> =>
    f.pipe(
      control(Abort, (_, abort) =>
        (sameScope(abort.scope, scope) ? ok(value) : abort) as Fx<Exclude<E, Abort<Scope>>, A | R>)
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
export function restartOnAbort<const Scope extends AnyControlScope>(
  scope: Scope,
  options: RestartOnAbortOptions
): <const E, const A>(f: Fx<E, A>) => Fx<ScopeEffects<E, Scope> | Abort<Scope>, A | ReturnValue<E, Scope>>
export function restartOnAbort<const Scope extends AnyControlScope>(
  scope: Scope,
  options: RestartOnAbortOptions
) {
  return restartOnAbortIn(scope, options)
}

/**
 * Restart a scoped computation when it aborts the supplied scope handle.
 */
export const restartOnAbortIn = <const Scope extends AnyControlScope>(
  scope: Scope,
  options: RestartOnAbortOptions
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ScopeEffects<E, Scope> | Abort<Scope>, A | ReturnValue<E, Scope>> =>
  fx(function* () {
    let restarts = 0
    let aborted: Abort<Scope> | undefined
    const attempt = f.pipe(
      inScope(scope),
      control(Abort, (_, abort) => {
        if (!sameScope(abort.scope, scope)) return abort

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
