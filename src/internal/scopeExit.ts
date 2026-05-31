import { ScopedEffect } from '../Effect.js'
import type { Fx } from '../Fx.js'
import type { AnyScope, Exit } from '../Scope.js'

export type ScopeExitRequest<Scope extends AnyScope> = (exit: Exit<Scope>) => void

export class ScopeExit<const Scope extends AnyScope>
  extends ScopedEffect('fx/internal/Scope/Exit')<Scope, void, ScopeExitRequest<Scope>> { }

export const scopeExit = <const Scope extends AnyScope>(
  scope: Scope
): Fx<ScopeExit<Scope>, ScopeExitRequest<Scope>> =>
  new ScopeExit(scope, undefined)
