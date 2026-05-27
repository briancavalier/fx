export const ScopeTypeId = Symbol('fx/Scope');
export const sameScope = (a, b) => a[ScopeTypeId] === b[ScopeTypeId];
