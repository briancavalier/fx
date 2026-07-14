import { ScopedEffect } from './Effect.js'
import type { AnyScope } from './Scope.js'

declare const ReceivingTypeId: unique symbol

export type Receiving<In> = {
  readonly [ReceivingTypeId]: {
    readonly in: In
  }
}

export type SinkInput<Scope> =
  Scope extends Receiving<infer In> ? In : never

export class Sink<
  const Scope extends AnyScope & Receiving<unknown>
> extends ScopedEffect('fx/Sink')<Scope, [], SinkInput<Scope>> { }

export const next = <const Scope extends AnyScope & Receiving<unknown>>(
  scope: Scope
): Sink<Scope> =>
  new Sink(scope)

export type SinkValue<E, Scope extends AnyScope & Receiving<unknown>> =
  E extends Sink<Scope> ? SinkInput<Scope> : never

export type ExcludeSink<E, Scope extends AnyScope & Receiving<unknown>, E2 = never> =
  E extends Sink<Scope> ? E2 : E
