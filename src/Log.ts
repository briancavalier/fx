import { Effect } from './Effect.js'
import { Fx, fx, map as mapFx, ok, unit } from './Fx.js'
import { handle } from './Handler.js'
import { now } from './Time.js'

export class Log extends Effect('fx/Log')<LogMessage, void> { }

export const log = (m: LogMessage) => new Log(m)

export const debug = (message: string, data?: Record<string, unknown>): Log => log({ level: Level.DEBUG, component: [], message, data })
export const info = (message: string, data?: Record<string, unknown>): Log => log({ level: Level.INFO, component: [], message, data })
export const warn = (message: string, data?: Record<string, unknown>): Log => log({ level: Level.WARN, component: [], message, data })
export const error = (message: string, data?: Record<string, unknown>): Log => log({ level: Level.ERROR, component: [], message, data })

export enum Level {
  DEBUG = 1,
  INFO,
  WARN,
  ERROR,
  SILENT
}

export interface LogMessage {
  readonly level: Level,
  readonly component: readonly string[],
  readonly message: string,
  readonly data?: { readonly [key: string]: unknown }
}

export const withConsoleLog = handle(Log, ({ arg: { level, component, ...m } }) => fx(function* () {
  const console = globalThis.console
  const l = Level[level].padEnd(5, ' ')
  const t = new Date(yield* now).toISOString()
  const path = `${component.join('.')}`
  const msg = Object.values(m).filter(v => v !== undefined)
  switch (level) {
    case Level.DEBUG: return console.debug(t, l, path, ...msg)
    case Level.INFO: return console.info(t, l, path, ...msg)
    case Level.WARN: return console.warn(t, l, path, ...msg)
    case Level.ERROR: return console.error(t, l, path, ...msg)
  }
}))

export const collect = <const E, const A>(f: Fx<E | Log, A>) => fx(function* () {
  const log = [] as LogMessage[]
  return yield* f.pipe(
    handle(Log, message => ok(void log.push(message.arg))),
    mapFx(a => [a, log as readonly LogMessage[]])
  )
})

export const minLevel = (min: Level) =>
  handle(Log, message => message.arg.level < min ? unit : log(message.arg))

export const child = <C extends { readonly [key: string]: unknown }>(component: string, context?: C) =>
  handle(Log, message => log({
    ...message.arg,
    component: [component, ...message.arg.component],
    data: { ...context, ...message.arg.data }
  }))
