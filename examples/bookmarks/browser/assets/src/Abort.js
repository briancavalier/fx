import { at } from './Breadcrumb.js';
import { ScopedEffect, withOrigin } from './Effect.js';
import { ok } from './Fx.js';
import { control } from './Handler.js';
/**
 * Abort the named scope without returning a result.
 */
export class Abort extends ScopedEffect('fx/Abort') {
}
export const abort = (scope) => withOrigin(new Abort(scope, undefined), at('fx/Abort/abort', abort));
/**
 * Return a default value from an abort of the named scope.
 */
export const orReturn = (scope, value) => (f) => f.pipe(control(Abort, (_, abort) => (abort.scope === scope ? ok(value) : abort)));
