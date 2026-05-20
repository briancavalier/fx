import { ScopedEffect } from './Effect.js'

declare const ReceivingTypeId: unique symbol

export type Receiving<In> = {
  readonly [ReceivingTypeId]: {
    readonly in: In
  }
}

export type SinkInput<Scope> =
  Scope extends Receiving<infer In> ? In : never

export class Sink<
  const Scope extends string & Receiving<unknown>
> extends ScopedEffect('fx/Sink')<Scope, void, SinkInput<Scope>> { }

export const next = <const Scope extends string & Receiving<unknown>>(
  scope: Scope
): Sink<Scope> =>
  new Sink(scope, undefined)

export type SinkValue<E, Scope extends string & Receiving<unknown>> =
  E extends Sink<Scope> ? SinkInput<Scope> : never

export type ExcludeSink<E, Scope extends string & Receiving<unknown>, E2 = never> =
  E extends Sink<Scope> ? E2 : E
