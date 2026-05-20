import { ScopedEffect } from './Effect.js'

declare const SinkingTypeId: unique symbol

export type Sinking<In> = {
  readonly [SinkingTypeId]: {
    readonly in: In
  }
}

export type SinkInput<Scope> =
  Scope extends Sinking<infer In> ? In : never

export class Sink<
  const Scope extends string & Sinking<unknown>
> extends ScopedEffect('fx/Sink')<Scope, void, SinkInput<Scope>> { }

export const next = <const Scope extends string & Sinking<unknown>>(
  scope: Scope
): Sink<Scope> =>
  new Sink(scope, undefined)

export type SinkValue<E, Scope extends string & Sinking<unknown>> =
  E extends Sink<Scope> ? SinkInput<Scope> : never

export type ExcludeSink<E, Scope extends string & Sinking<unknown>, E2 = never> =
  E extends Sink<Scope> ? E2 : E
