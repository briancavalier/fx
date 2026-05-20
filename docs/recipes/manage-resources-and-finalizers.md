# Manage Resources and Finalizers

Use this when acquiring a resource that must be released when a named scope
exits.

```ts
import { fx, runPromise } from "@briancavalier/fx"
import { managed, scope, usingManaged } from "@briancavalier/fx/scope"

const RequestScope = "app/Request" as const

const openConnection = fx(function* () {
  return managed(
    { id: "connection-1" },
    exit => closeConnection(exit)
  )
})

const program = fx(function* () {
  const connection = yield* usingManaged(RequestScope, openConnection)
  return yield* query(connection)
}).pipe(
  scope(RequestScope)
)
```

Use `using` or `usingManaged` to acquire and register cleanup in a small
uninterruptible region. `using` finalizers receive the acquired value and the
scope exit, and may ignore the exit when cleanup does not depend on it.

Handler pipeline:

```ts
program.pipe(
  resourceHandlers,
  runPromise
)
```

Common mistake: acquiring a resource and registering its cleanup in separate,
interruptible steps.
