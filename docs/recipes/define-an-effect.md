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

const findUser = (id: string) => new FindUser(id)
```

The first type parameter is the request argument. The second is the answer that
`yield*` receives.

```ts
const user = yield* findUser("user-1")
```

Handler pipeline:

```ts
program.pipe(
  handle(FindUser, effect => ok(users.get(effect.arg))),
  run
)
```

Common mistake: creating a service object or wrapper class when one effect class
and a small constructor function are enough.
