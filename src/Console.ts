import { Effect } from "./Effect.js"
import { Fx, ok } from "./Fx.js"
import { handle } from './Handler.js'

export type Console = Log | Error

export class Log extends Effect("fx/Console/Log")<[readonly unknown[]], void> { }

export const log = (...args: readonly unknown[]) => new Log(args)

export class Error extends Effect("fx/Console/Error")<[readonly unknown[]], void> { }

export const error = (...args: readonly unknown[]) => new Error(args)

export const defaultConsole = <const E, const A>(f: Fx<E, A>) =>
  f.pipe(
    handle(Log, log => ok(globalThis.console.log(...log.arg))),
    handle(Error, error => ok(globalThis.console.error(...error.arg)))
  )
