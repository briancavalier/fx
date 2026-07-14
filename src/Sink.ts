import { KeyedEffect } from './Effect.js'
import type { AnyKey } from './Key.js'

declare const ReceivingTypeId: unique symbol

export type Receiving<In> = {
  readonly [ReceivingTypeId]: {
    readonly in: In
  }
}

export type SinkInput<Scope> =
  Scope extends Receiving<infer In> ? In : never

export class Sink<
  const Key extends AnyKey & Receiving<unknown>
> extends KeyedEffect('fx/Sink')<Key, void, SinkInput<Key>> { }

export const next = <const Key extends AnyKey & Receiving<unknown>>(
  key: Key
): Sink<Key> =>
  new Sink(key, undefined)

export type SinkValue<E, Key extends AnyKey & Receiving<unknown>> =
  E extends Sink<Key> ? SinkInput<Key> : never

export type ExcludeSink<E, Key extends AnyKey & Receiving<unknown>, E2 = never> =
  E extends Sink<Key> ? E2 : E
