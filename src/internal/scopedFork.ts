import { ScopedEffect } from '../Effect.js'
import type { Fx } from '../Fx.js'
import type { AnyScope } from '../Scope.js'
import type { Task } from '../Task.js'
import type { TraceOrigin } from '../Trace.js'

export class ScopedFork<
  const Scope extends AnyScope = AnyScope
> extends ScopedEffect('fx/Scope/ScopedFork')<Scope, ScopedForkContext, Task<unknown, unknown>> { }

export type ScopedForkContext = TraceOrigin & {
  readonly fx: Fx<unknown, unknown>
  readonly failure?: 'scope' | 'task' | 'join'
} & (
  | MeteredScopedForkContext
  | DaemonScopedForkContext
)

interface MeteredScopedForkContext {
  /**
   * Non-daemon scoped forks are always metered and keep their scope open on
   * normal completion.
   */
  readonly daemon?: false | undefined
  readonly scheduling?: undefined
}

interface DaemonScopedForkContext {
  /**
   * Internal daemon scoped forks are still owned by their scope, but do not
   * hold the scope open on normal completion.
   */
  readonly daemon: true
  /**
   * Daemon scoped forks may opt out of concurrency admission for internal
   * scheduler work such as timeout timers.
   */
  readonly scheduling?: 'metered' | 'unmetered'
}
