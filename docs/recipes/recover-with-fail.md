# Recover with Fail

Use this when an operation can fail recoverably and callers should decide how to
recover.

```ts
import { catchOnly, fail, ok, run, runCatch } from "@briancavalier/fx"

class NotFound extends Error {}

const requireUser = (user: User | undefined) =>
  user === undefined
    ? fail(new NotFound("user not found"))
    : ok(user)

const userOrGuest = requireUser(user).pipe(
  catchOnly(NotFound, () => ok({ id: "guest", name: "Guest" })),
  runCatch
)
```

`catchOnly`, `catchIf`, and `catchAll` construct a recovery region. Add
`runCatch` where that region should use the default catch interpretation.

Handler pipeline:

```ts
program.pipe(
  catchOnly(NotFound, () => ok(guestUser)),
  runCatch,
  run
)
```

Common mistake: throwing recoverable validation or lookup errors from inside an
`Fx` program. Throw only for hard crashes or internal invariants.
