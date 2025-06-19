import { Effect } from "./Effect"
import { Fx, ok } from "./Fx"
import { handle } from './Handler'

export type Console = Log | Error

export class Log extends Effect("fx/Console/Log")<readonly unknown[], void> { }

export const log = (...args: readonly unknown[]) => new Log(args)

export class Error extends Effect("fx/Console/Error")<readonly unknown[], void> { }

export const error = (...args: readonly unknown[]) => new Error(args)

export const defaultConsole = <const E, const A>(f: Fx<E, A>) =>
  f.pipe(
    handle(Log, args => ok(globalThis.console.log(...args))),
    handle(Error, args => ok(globalThis.console.error(...args)))
  )
