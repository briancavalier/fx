export const ScopeTypeId = Symbol('fx/Scope')

export interface ScopeIdentity<Identity extends PropertyKey = PropertyKey> {
  readonly [ScopeTypeId]: Identity
}

export type AnyScopeIdentity = ScopeIdentity<PropertyKey>

export const scopeId = <const Scope extends AnyScopeIdentity>(scope: Scope): Scope[typeof ScopeTypeId] =>
  scope[ScopeTypeId]

export const sameScope = (a: AnyScopeIdentity, b: AnyScopeIdentity): boolean =>
  scopeId(a) === scopeId(b)
