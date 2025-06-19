import { Effect } from './Effect'
import { Fx, fx, map, ok, unit } from './Fx'
import { handle } from './Handler'
import { now } from './Time'

export class Log<M> extends Effect('fx/Log')<M, void> { }

export const log = <const M>(m: M) => new Log(m)

export const debug = (msg: string, data?: unknown): Log<LogMessage> => log({ level: Level.DEBUG, msg, data })
export const info = (msg: string, data?: unknown): Log<LogMessage> => log({ level: Level.INFO, msg, data })
export const warn = (msg: string, data?: unknown): Log<LogMessage> => log({ level: Level.WARN, msg, data })
export const error = (msg: string, data?: unknown): Log<LogMessage> => log({ level: Level.ERROR, msg, data })

export enum Level {
  DEBUG = 1,
  INFO,
  WARN,
  ERROR,
  SILENT
}

export interface HasLevel {
  readonly level: Level
}

export interface HasContext {
  readonly context?: Record<string, unknown>
}

export interface LogMessage extends HasLevel, HasContext {
  readonly msg: string,
  readonly data?: unknown
}

export const console = handle(Log<HasLevel>, ({ level, ...msg }) => fx(function* () {
  const c = globalThis.console
  const l = Level[level]
  const t = new Date(yield* now).toISOString()
  const m = Object.values(msg).filter(v => v !== undefined)
  switch (level) {
    case Level.DEBUG: return c.debug(l, t, ...m)
    case Level.INFO: return c.info(l, t, ...m)
    case Level.WARN: return c.warn(l, t, ...m)
    case Level.ERROR: return c.error(l, t, ...m)
  }
}))

export const collect = <const M, const E, const A>(f: Fx<E | Log<M>, A>) => fx(function* () {
  const log = [] as M[]
  return yield* f.pipe(
    handle(Log<M>, m => ok(void log.push(m))),
    map(a => [a, log as readonly M[]])
  )
})

export const minLevel = <const M extends HasLevel>(min: Level) =>
  handle(Log<M>, m =>
    m.level >= min ? log(m) : unit
  )

export const context = <const M extends HasContext>(context: Record<string, unknown>) =>
  handle(Log<M>, m =>
    log({ ...m, context: { ...m.context, ...context } }))

