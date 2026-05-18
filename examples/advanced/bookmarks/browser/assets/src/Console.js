import { Effect } from "./Effect.js";
import { ok } from "./Fx.js";
import { handle } from './Handler.js';
export class Log extends Effect("fx/Console/Log") {
}
export const log = (...args) => new Log(args);
export class Error extends Effect("fx/Console/Error") {
}
export const error = (...args) => new Error(args);
export const defaultConsole = (f) => f.pipe(handle(Log, log => ok(globalThis.console.log(...log.arg))), handle(Error, error => ok(globalThis.console.error(...error.arg))));
