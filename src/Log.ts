import { Effect } from './Effect'
import { Fx, fx, handle, map, ok } from './Fx'

import { now } from './Time'

export class Log extends Effect('fx/Log')<LogMessage, void> {}

export const log = (m: LogMessage) => new Log(m)

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
    const t = yield* now
    const c = globalThis.console
    switch (level) {
      case Level.debug: return c.debug(new Date(t).toISOString(), 'DEBUG', msg, { ...data, ...context })
      case Level.warn: return c.warn(new Date(t).toISOString(), 'WARN ', msg, { ...data, ...context })
      case Level.error: return c.error(new Date(t).toISOString(), 'ERROR', msg, { ...data, ...context })
      default: return c.info(new Date(t).toISOString(), 'INFO ', msg, { ...data, ...context })
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
  handle(Log, message => fx(function* () {
    return message.level >= min ? yield* log(message) : undefined
  }))

export const context = (context: Record<string, unknown>) =>
  handle(Log, message => log({ ...message, context: { ...message.context, ...context } }))

export const debug = (msg: string, data?: Record<string, unknown>) => log({ level: Level.debug, msg, data })
export const info = (msg: string, data?: Record<string, unknown>) => log({ level: Level.info, msg, data })
export const warn = (msg: string, data?: Record<string, unknown>) => log({ level: Level.error, msg, data })
export const error = (msg: string, data?: Record<string, unknown>) => log({ level: Level.warn, msg, data })
