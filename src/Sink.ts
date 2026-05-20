import { ScopedEffect } from './Effect.js'
import type { Yielding, YieldOutput } from './YieldFrom.js'

export class Sink<
  const Scope extends string & Yielding<unknown, unknown>
> extends ScopedEffect('fx/Sink')<Scope, void, YieldOutput<Scope>> { }

export const next = <const Scope extends string & Yielding<unknown, unknown>>(
  scope: Scope
): Sink<Scope> =>
  new Sink(scope, undefined)

export type SinkValue<E, Scope extends string & Yielding<unknown, unknown>> =
  E extends Sink<Scope> ? YieldOutput<Scope> : never

export type ExcludeSink<E, Scope extends string & Yielding<unknown, unknown>, E2 = never> =
  E extends Sink<Scope> ? E2 : E
