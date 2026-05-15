import { EffectType } from './Effect.js'
import { Fx } from './Fx.js'
import { Answer, Arg, Control, Handler } from './internal/Handler.js'
export type { Arg }

/**
 * Replace handled effects in `E` with effects produced by a handler.
 */
export type Handle<E, A, B = never> = E extends A ? B : E

/**
 * Return values produced by a control handler for matching effects.
 */
export type HandleReturn<E, A, R> = E extends A ? R : never

/**
 * A scoped effect narrowed to the scope currently being handled.
 */
export type MatchedScopedEffect<A, Scope extends string> =
  A & { readonly scope: Scope }

/**
 * A scoped effect with the handled scope removed from its remaining scope type.
 */
export type ResidualScopedEffect<E, Scope extends string> =
  E extends { readonly scope: infer EffectScope extends string }
  ? Exclude<EffectScope, Scope> extends never
    ? never
    : E & { readonly scope: Exclude<EffectScope, Scope> }
  : E

/**
 * Replace matching scoped effects in `E` with effects produced by a handler.
 */
export type HandleScoped<E, A, Scope extends string, B = never> =
  E extends A
  ? E extends { readonly scope: infer EffectScope extends string }
    ? Extract<EffectScope, Scope> extends never
      ? E
      : B | ResidualScopedEffect<E, Scope>
    : E
  : E

/**
 * An effect constructor whose instances carry a top-level scope name.
 */
export type ScopedEffectType =
  EffectType & { new(...args: readonly any[]): { readonly scope: string } }

/**
 * The scope names produced by a scoped effect constructor.
 */
export type EffectScope<T extends ScopedEffectType> =
  InstanceType<T>['scope']

/**
 * Handle effects of the given type.
 *
 * @example
 * ```ts
 * class AskName extends Effect('app/AskName')<void, string> { }
 *
 * const program = fx(function* () {
 *   return `hello ${yield* new AskName()}`
 * })
 *
 * const result = program.pipe(
 *   handle(AskName, () => ok('Ada')),
 *   run
 * )
 * ```
 */
export const handle = <T extends EffectType, HandlerEffects>(
  e: T,
  f: (effect: InstanceType<T>) => Fx<HandlerEffects, Answer<T>>
) => <const E, const A>(
  fx: Fx<E, A>
): Fx<Handle<E, InstanceType<T>, HandlerEffects>, A> =>
    new Handler(fx, e._fxEffectId, f) as Fx<Handle<E, InstanceType<T>, HandlerEffects>, A>

/**
 * Handle scoped effects of the given type from one scope.
 *
 * Effects of the same type from other scopes are left unhandled.
 *
 * @example
 * ```ts
 * class Ask<const Scope extends string>
 *   extends ScopedEffect('app/Ask')<Scope, void, string> { }
 *
 * const program = fx(function* () {
 *   return yield* new Ask('user', undefined)
 * })
 *
 * const result = program.pipe(
 *   handleScoped(Ask, 'user', () => ok('Ada')),
 *   run
 * )
 * ```
 */
export const handleScoped = <T extends ScopedEffectType, const Scope extends EffectScope<T>, HandlerEffects>(
  e: T,
  scope: Scope,
  f: (effect: MatchedScopedEffect<InstanceType<T>, Scope>) => Fx<HandlerEffects, Answer<T>>
) => <const E, const A>(
  fx: Fx<E, A>
): Fx<HandleScoped<E, InstanceType<T>, Scope, HandlerEffects>, A> =>
    new Handler(fx, e._fxEffectId, effect => {
      if (effect.scope === scope) {
        return f(effect as MatchedScopedEffect<InstanceType<T>, Scope>)
      }

      return effect as Fx<InstanceType<T>, Answer<T>>
    }) as Fx<HandleScoped<E, InstanceType<T>, Scope, HandlerEffects>, A>

/**
 * Handle effects of the given type with control over resuming the program.
 *
 * @example
 * ```ts
 * class Choose extends Effect('app/Choose')<void, boolean> { }
 *
 * const program = fx(function* () {
 *   return yield* new Choose()
 * })
 *
 * const result = program.pipe(
 *   control(Choose, resume => ok(resume(true))),
 *   run
 * )
 * ```
 */
export const control = <T extends EffectType, HandlerEffects = never, R = never>(
  e: T,
  f: <A>(resume: (a: Answer<T>) => A, effect: InstanceType<T>) => Fx<HandlerEffects, R>
) => <const E, const A>(
  fx: Fx<E, A>
): Fx<Handle<E, InstanceType<T>, HandlerEffects>, HandleReturn<E, InstanceType<T>, R> | A> =>
    new Control(fx, e._fxEffectId, f) as Fx<Handle<E, InstanceType<T>, HandlerEffects>, HandleReturn<E, InstanceType<T>, R> | A>
