import { ScopedEffect } from '../Effect.js'
import type { Fx } from '../Fx.js'
import type { AnyScope } from '../Scope.js'
import type { Task } from '../Task.js'
import type { TraceOrigin } from '../Trace.js'
import type { ForkScheduling } from './concurrent/effects.js'

export class ScopedFork<
  const Scope extends AnyScope = AnyScope
> extends ScopedEffect('fx/Scope/ScopedFork')<Scope, [ScopedForkContext], Task<unknown, unknown>> { }

export interface ScopedForkContext extends TraceOrigin {
  readonly fx: Fx<unknown, unknown>
  /**
   * Advanced scheduling mode. Defaults to `metered`.
   *
   * Unmetered scoped forks skip only concurrency admission. They remain
   * scope-owned and keep normal cleanup, failure, trace, and handler-capture
   * behavior.
   */
  readonly scheduling?: ForkScheduling
  /**
   * Internal daemon scoped forks are still owned by their scope, but do not
   * hold the scope open on normal completion.
   */
  readonly daemon?: boolean
  readonly failure?: 'scope' | 'task' | 'join'
}
