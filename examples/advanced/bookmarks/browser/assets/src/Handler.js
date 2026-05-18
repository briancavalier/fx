import { Control, Handler } from './internal/Handler.js';
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
export const handle = (e, f) => (fx) => new Handler(fx, e._fxEffectId, f);
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
export const handleScoped = (e, scope, f) => (fx) => new Handler(fx, e._fxEffectId, effect => {
    if (effect.scope === scope) {
        return f(effect);
    }
    return effect;
});
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
export const control = (e, f) => (fx) => new Control(fx, e._fxEffectId, f);
