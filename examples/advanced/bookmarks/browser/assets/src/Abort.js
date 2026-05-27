import { at } from './Breadcrumb.js';
import { ScopedEffect, withOrigin } from './Effect.js';
import { fx, ok } from './Fx.js';
import { control } from './Handler.js';
import { withScope } from './Scope.js';
import { sameScope } from './internal/scopeIdentity.js';
/**
 * Abort the named scope without returning a result.
 */
export class Abort extends ScopedEffect('fx/Abort') {
}
export const abort = (scope) => withOrigin(new Abort(scope, undefined), at('fx/Abort/abort', abort));
/**
 * Return a default value from an abort of the named scope.
 */
export const orReturn = (scope, value) => (f) => f.pipe(control(Abort, (_, abort) => (sameScope(abort.scope, scope) ? ok(value) : abort)));
const Restart = Symbol('fx/Abort/restartOnAbort');
/**
 * Restart a scoped computation when it aborts the named scope.
 */
export const restartOnAbort = (scope, options) => (f) => fx(function* () {
    let restarts = 0;
    let aborted;
    const attempt = f.pipe(withScope(scope), control(Abort, (_, abort) => {
        if (!sameScope(abort.scope, scope))
            return abort;
        aborted = abort;
        return ok(Restart);
    }));
    while (true) {
        const result = yield* attempt;
        if (result !== Restart)
            return result;
        if (restarts >= options.restarts)
            return yield* aborted;
        restarts += 1;
    }
});
