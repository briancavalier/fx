# Write a Handler

Use this when a program has an effect and the boundary needs to interpret it.

```ts
import { handle, ok, run } from "@briancavalier/fx"

const memoryUsers = (users: ReadonlyMap<string, User>) =>
  handle(FindUser, effect => ok(users.get(effect.arg)))
```

Handlers remove the handled effect from the program's effect union and may add
new effects of their own.

```ts
const result = program.pipe(
  memoryUsers(new Map([["user-1", { id: "user-1", name: "Ada" }]])),
  run
)
```

Use `control` only when the handler needs to decide whether or how to resume the
program.

Common mistake: hiding many unrelated handlers behind a generic dependency layer.
Prefer an explicit pipeline unless the grouped boundary has a real domain name.
