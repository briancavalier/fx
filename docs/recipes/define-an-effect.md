# Define an Effect

Use this when application logic needs to request an operation without choosing
how it is performed.

```ts
import { Effect, handle, ok, run } from "@briancavalier/fx"

type User = {
  readonly id: string
  readonly name: string
}

class FindUser extends Effect("app/User/Find")<string, User | undefined> {}
```

The first type parameter is the request argument. The second is the answer that
`yield*` receives.

```ts
const user = yield* FindUser.of("user-1")
```

Handler pipeline:

```ts
program.pipe(
  handle(FindUser, effect => ok(users.get(effect.arg))),
  run
)
```

Use a named helper only when construction does more than build the request, such
as adapting arguments, adding defaults, or flattening a higher-order effect.
