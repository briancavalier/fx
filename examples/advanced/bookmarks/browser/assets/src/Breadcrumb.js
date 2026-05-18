import { capturesStack } from './internal/runtimeContext.js';
/**
 * Capture a Breadcrumb with the provided message.
 */
export const at = (message, f = at) => capturesStack() ? new BreadcrumbAt(message, f) : { message };
/**
 * Derive an indexed Breadcrumb from an existing Breadcrumb while preserving the
 * original stack frames.
 */
export const indexed = (origin, index) => {
    const message = `${origin.message}[${index}]`;
    return {
        message,
        get stack() {
            return replaceStackMessage(origin.stack, origin.message, message);
        }
    };
};
class BreadcrumbAt extends Error {
    message;
    constructor(message, f, options) {
        super(message, options);
        this.message = message;
        if (Error.captureStackTrace)
            Error.captureStackTrace(this, f);
    }
}
const replaceStackMessage = (stack, current, next) => {
    if (stack === undefined)
        return undefined;
    const lineEnd = stack.indexOf('\n');
    const firstLine = lineEnd === -1 ? stack : stack.slice(0, lineEnd);
    const rest = lineEnd === -1 ? '' : stack.slice(lineEnd);
    const replaced = firstLine.includes(current)
        ? firstLine.replace(current, next)
        : next;
    return `${replaced}${rest}`;
};
