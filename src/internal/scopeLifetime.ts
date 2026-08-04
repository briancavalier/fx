type ScopeLike = object & {
  readonly label?: string
}

const closedScopes = new WeakSet<object>()
const closeableScopes = new WeakSet<object>()

export const markScopeCloseable = (scope: object): void => {
  closeableScopes.add(scope)
}

export const assertScopeOpen = (scope: object, label?: string): void => {
  if (closedScopes.has(scope)) {
    throw new Error(`Scope handle ${label ?? scopeLabel(scope)} was used after its scope exited`)
  }
}

export const closeScope = (scope: object): void => {
  if (closeableScopes.has(scope)) closedScopes.add(scope)
}

const scopeLabel = (scope: object): string =>
  (scope as ScopeLike).label ?? 'unknown'
