import { Effect } from './Effect'
import { Fx, fx, handle, map, ok } from './Fx'

export class Log extends Effect('fx/Log')<LogMessage, void> { }

export const log = (m: LogMessage) => new Log(m)

export const debug = (msg: string, data?: Record<string, unknown>) => log({ level: Level.debug, msg, data })
export const info = (msg: string, data?: Record<string, unknown>) => log({ level: Level.info, msg, data })
export const warn = (msg: string, data?: Record<string, unknown>) => log({ level: Level.warn, msg, data })
export const error = (msg: string, data?: Record<string, unknown>) => log({ level: Level.error, msg, data })

export enum Level {
  debug = 1,
  info,
  warn,
  error,
  silent
}

export interface LogMessage {
  level: Level,
  msg: string,
  data?: Record<string, unknown> | undefined,
  context?: Record<string, unknown> | undefined
}

export const console = handle(Log, ({ level, msg, data, context }) => fx(function* () {
  const c = globalThis.console
  const args = data || context ? [msg, { ...context, ...data }] : [msg]
  switch (level) {
    case Level.debug: return c.debug(...args)
    case Level.info: return c.info(...args)
    case Level.warn: return c.warn(...args)
    case Level.error: return c.error(...args)
  }
}))

export const collect = <const E, const A>(f: Fx<E, A>) => fx(function* () {
  const log = [] as LogMessage[]
  return yield* f.pipe(
    handle(Log, message => ok(void log.push(message))),
    map(a => [a, log])
  )
})

export const minLevel = (min: Level) =>
  handle(Log, message =>
    message.level >= min ? log(message) : ok(undefined))

export const context = (context: Record<string, unknown>) =>
  handle(Log, message =>
    log({ ...message, context: { ...message.context, ...context } }))

