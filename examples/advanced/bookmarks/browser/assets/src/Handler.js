import { Control, Handler } from './internal/Handler.js';
import { sameScope } from './internal/scopeIdentity.js';
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
export const handle = (e, f) => (fx) => new Handler(fx, e._fxEffectId, f);
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
export const handleScoped = (e, scope, f) => (fx) => new Handler(fx, e._fxEffectId, effect => {
    if (sameScope(effect.scope, scope)) {
        return f(effect);
    }
    return effect;
});
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
export const control = (e, f) => (fx) => new Control(fx, e._fxEffectId, f);
