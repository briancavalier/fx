# Manage Resources and Finalizers

Use this when acquiring a resource that must be released when a named scope
exits.

```ts
import { usingManaged, managed } from "@briancavalier/fx/Finalization"
import { scope } from "@briancavalier/fx/Scope"

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

Use `using`, `usingExit`, or `usingManaged` to acquire and register cleanup in a
small uninterruptible region.

Handler pipeline:

```ts
program.pipe(
  resourceHandlers,
  runPromise
)
```

Common mistake: acquiring a resource and registering its cleanup in separate,
interruptible steps.
