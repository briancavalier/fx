# Manage Resources and Finalizers

Use this when acquiring a resource that must be released when a lexical scope
exits.

```ts
import { fx, runPromise } from "@briancavalier/fx"
import { inScope, managed, usingManagedIn, withScope } from "@briancavalier/fx/scope"

const openConnection = fx(function* () {
  return managed(
    { id: "connection-1" },
    exit => closeConnection(exit)
  )
})

const program = withScope({ label: "app/Request" }, scope => inScope(scope, fx(function* () {
  const connection = yield* usingManagedIn(scope, openConnection)
  return yield* query(connection)
})))
```

Use `usingIn` or `usingManagedIn` to acquire and register cleanup in an explicit
scope handle in a small uninterruptible region. `usingIn` finalizers receive
the acquired value and the scope exit, and may ignore the exit when cleanup does
not depend on it.

Handler pipeline:

```ts
program.pipe(
  resourceHandlers,
  runPromise
)
```

Common mistake: acquiring a resource and registering its cleanup in separate,
interruptible steps.
