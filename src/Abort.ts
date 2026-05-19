import { at } from './Breadcrumb.js'
import { ScopedEffect, withOrigin } from './Effect.js'
import { Fx, fx, ok } from './Fx.js'
import { GlobalScope } from './GlobalScope.js'
import { control } from './Handler.js'
import { scope as scoped, type ReturnValue, type ScopeEffects } from './Scope.js'

/**
 * Abort the named scope without returning a result.
 */
export class Abort<const Scope extends string> extends ScopedEffect('fx/Abort')<Scope, void, never> { }

export function abort(): Fx<Abort<typeof GlobalScope>, never>
export function abort<const Scope extends string>(scope: Scope): Fx<Abort<Scope>, never>
export function abort(scope: string = GlobalScope): Fx<Abort<any>, never> {
  return withOrigin(new Abort(scope, undefined), at('fx/Abort/abort', abort))
}

/**
 * Return a default value from an abort of the named scope.
 */
export function orReturn<const R>(
  value: R
): <const E, const A>(f: Fx<E, A>) => Fx<Exclude<E, Abort<typeof GlobalScope>>, A | R>
export function orReturn<const Scope extends string, const R>(
  scope: Scope,
  value: R
): <const E, const A>(f: Fx<E, A>) => Fx<Exclude<E, Abort<Scope>>, A | R>
export function orReturn(
  scopeOrValue: unknown,
  maybeValue?: unknown
): unknown {
  const scope = arguments.length === 1 ? GlobalScope : scopeOrValue as string
  const value = arguments.length === 1 ? scopeOrValue : maybeValue

  return <const E, const A>(f: Fx<E, A>): Fx<Exclude<E, Abort<string>>, unknown> =>
    f.pipe(
      control(Abort, (_, abort) =>
        (abort.scope === scope ? ok(value) : abort) as Fx<Exclude<E, Abort<string>>, unknown>)
    ) as Fx<Exclude<E, Abort<string>>, unknown>
}

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
export const restartOnAbort = <const Scope extends string>(
  scope: Scope,
  options: RestartOnAbortOptions
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ScopeEffects<E, Scope> | Abort<Scope>, A | ReturnValue<E, Scope>> =>
  fx(function* () {
    let restarts = 0
    let aborted: Abort<Scope> | undefined
    const attempt = f.pipe(
      scoped(scope),
      control(Abort, (_, abort) => {
        if (abort.scope !== scope) return abort

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
