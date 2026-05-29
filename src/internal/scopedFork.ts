import { ScopedEffect } from '../Effect.js'
import type { Fx } from '../Fx.js'
import type { AnyScope } from '../Scope.js'
import type { Task } from '../Task.js'
import type { TraceOrigin } from '../Trace.js'

export class ScopedFork<
  const Scope extends AnyScope = AnyScope
> extends ScopedEffect('fx/Scope/ScopedFork')<Scope, ScopedForkContext, Task<unknown, unknown>> { }

export interface ScopedForkContext extends TraceOrigin {
  readonly fx: Fx<unknown, unknown>
  /**
   * Internal daemon scoped forks are still owned by their scope, but do not
   * hold the scope open on normal completion.
   */
  readonly daemon?: boolean
}
