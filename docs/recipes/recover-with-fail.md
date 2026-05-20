# Recover with Fail

Use this when an operation can fail recoverably and callers should decide how to
recover.

```ts
import { catchOnly, fail, ok } from "@briancavalier/fx"

class NotFound extends Error {}

const requireUser = (user: User | undefined) =>
  user === undefined
    ? fail(new NotFound("user not found"))
    : ok(user)

const userOrGuest = requireUser(user).pipe(
  catchOnly(NotFound, () => ok({ id: "guest", name: "Guest" }))
)
```

`Fail<E>` stays in the effect union until `catchOnly`, `catchIf`, `catchAll`, or
another handler eliminates it.

Handler pipeline:

```ts
program.pipe(
  catchOnly(NotFound, () => ok(guestUser)),
  run
)
```

Common mistake: throwing recoverable validation or lookup errors from inside an
`Fx` program. Throw only for hard crashes or internal invariants.
