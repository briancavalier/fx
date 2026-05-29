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
  readonly keepAlive?: boolean
}
