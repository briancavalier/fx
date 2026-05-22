export const ScopeTypeId = Symbol('fx/Scope')

export interface ScopeIdentity<Name extends string = string> {
  readonly [ScopeTypeId]: Name
}

export type AnyScopeIdentity = ScopeIdentity<string>

export const sameScope = (a: AnyScopeIdentity, b: AnyScopeIdentity): boolean =>
  a[ScopeTypeId] === b[ScopeTypeId]
