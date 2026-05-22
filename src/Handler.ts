import { EffectType } from './Effect.js'
import { Fx } from './Fx.js'
import type { AnyScope } from './Scope.js'
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

type MatchedScopedEffect<A, Scope extends AnyScope> =
  A & { readonly scope: Scope }

type ResidualScopedEffect<E, Scope extends AnyScope> =
  E extends { readonly scope: infer EffectScope extends AnyScope }
  ? Exclude<EffectScope, Scope> extends never
    ? never
    : E & { readonly scope: Exclude<EffectScope, Scope> }
  : E

/**
 * Replace matching scoped effects in `E` with effects produced by a handler.
 */
export type HandleScoped<E, A, Scope extends AnyScope, B = never> =
  E extends A
  ? E extends { readonly scope: infer EffectScope extends AnyScope }
    ? Extract<EffectScope, Scope> extends never
      ? E
      : B | ResidualScopedEffect<E, Scope>
    : E
  : E

type ScopedEffectType =
  EffectType & { new(...args: readonly any[]): { readonly scope: AnyScope } }

type EffectScope<T extends ScopedEffectType> =
  InstanceType<T>['scope']

/**
 * Handle effects of the given type.
 *
 * The handler receives the requested effect and returns an Fx for the answer.
 * `handle` removes the handled effect from the program's effect union and adds
 * any effects requested by the handler.
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
 * class Ask<const S extends Scope>
 *   extends ScopedEffect('app/Ask')<Scope, void, string> { }
 *
 * const program = fx(function* () {
 *   return yield* new Ask(UserScope, undefined)
 * })
 *
 * const result = program.pipe(
 *   handleScoped(Ask, UserScope, () => ok('Ada')),
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
      if (effect.scope.name === scope.name) {
        return f(effect as MatchedScopedEffect<InstanceType<T>, Scope>)
      }

      return effect as Fx<InstanceType<T>, Answer<T>>
    }) as Fx<HandleScoped<E, InstanceType<T>, Scope, HandlerEffects>, A>

/**
 * Handle effects of the given type with control over resuming the program.
 *
 * Use `control` when a handler needs to choose whether, when, or how often to
 * resume the suspended computation. Use {@link handle} for simple one-request,
 * one-answer interpretation.
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
