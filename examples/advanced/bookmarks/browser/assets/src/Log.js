import { Effect } from './Effect.js';
import { fx, map as mapFx, ok, unit } from './Fx.js';
import { handle } from './Handler.js';
import { now } from './Time.js';
export class Log extends Effect('fx/Log') {
}
export const log = (m) => new Log(m);
export const debug = (message, data) => log({ level: Level.DEBUG, component: [], message, data });
export const info = (message, data) => log({ level: Level.INFO, component: [], message, data });
export const warn = (message, data) => log({ level: Level.WARN, component: [], message, data });
export const error = (message, data) => log({ level: Level.ERROR, component: [], message, data });
export var Level;
(function (Level) {
    Level[Level["DEBUG"] = 1] = "DEBUG";
    Level[Level["INFO"] = 2] = "INFO";
    Level[Level["WARN"] = 3] = "WARN";
    Level[Level["ERROR"] = 4] = "ERROR";
    Level[Level["SILENT"] = 5] = "SILENT";
})(Level || (Level = {}));
export const withConsoleLog = handle(Log, ({ arg: { level, component, ...m } }) => fx(function* () {
    const console = globalThis.console;
    const l = Level[level].padEnd(5, ' ');
    const t = new Date(yield* now).toISOString();
    const path = `${component.join('.')}`;
    const msg = Object.values(m).filter(v => v !== undefined);
    switch (level) {
        case Level.DEBUG: return console.debug(t, l, path, ...msg);
        case Level.INFO: return console.info(t, l, path, ...msg);
        case Level.WARN: return console.warn(t, l, path, ...msg);
        case Level.ERROR: return console.error(t, l, path, ...msg);
    }
}));
export const collect = (f) => fx(function* () {
    const log = [];
    return yield* f.pipe(handle(Log, message => ok(void log.push(message.arg))), mapFx(a => [a, log]));
});
export const minLevel = (min) => handle(Log, message => message.arg.level < min ? unit : log(message.arg));
export const child = (component, context) => handle(Log, message => log({
    ...message.arg,
    component: [component, ...message.arg.component],
    data: { ...context, ...message.arg.data }
}));
