export const ScopeTypeId = Symbol('fx/Scope')

export interface ScopeIdentity<Identity extends PropertyKey = PropertyKey> {
  readonly [ScopeTypeId]: Identity
}

export type AnyScopeIdentity = ScopeIdentity<PropertyKey>

export const sameScope = (a: AnyScopeIdentity, b: AnyScopeIdentity): boolean =>
  a[ScopeTypeId] === b[ScopeTypeId]
