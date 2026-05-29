export const ScopeTypeId = Symbol('fx/Scope');
export const scopeId = (scope) => scope[ScopeTypeId];
export const sameScope = (a, b) => scopeId(a) === scopeId(b);
