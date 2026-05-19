# Use Scoped Control

Use this when a computation needs to exit a delimited region early.

Use the default global scope when the program and its handler are owned together
in local application code and there is only one intended control region. It
keeps that case compact while preserving the effect requirement in the type.

```ts
import { abort, orReturn } from "@briancavalier/fx/Abort"
import { fx, run } from "@briancavalier/fx"
import { scope } from "@briancavalier/fx/Scope"

const loadUser = (id: string | undefined) => fx(function* () {
  if (id === undefined) yield* abort()

  return yield* fetchUser(id)
})

const user = loadUser(input.id).pipe(
  scope(),
  orReturn(guestUser),
  run
)
```

Use an explicit named scope when the control region has an owner that should
remain visible to callers. That includes reusable helpers, public APIs, nested
regions, resources, retries, and examples that teach handler composition.

```ts
import { abort, orReturn, restartOnAbort } from "@briancavalier/fx/Abort"
import { fx, run } from "@briancavalier/fx"
import { returnFrom } from "@briancavalier/fx/ReturnFrom"
import { scope } from "@briancavalier/fx/Scope"

const RequestScope = "app/Request" as const

const loadRequest = (request: Request) => fx(function* () {
  if (!request.authorized) yield* returnFrom(RequestScope, unauthorized)

  const user = yield* loadUser(request.userId)
  if (user.disabled) yield* abort(RequestScope)

  return okResponse(user)
})

const response = loadRequest(request).pipe(
  restartOnAbort(RequestScope, { restarts: 1 }),
  scope(RequestScope),
  orReturn(RequestScope, unavailable),
  run
)
```

`restartOnAbort` takes an explicit scope. Retryable control has a visible owner,
so do not treat the global scope as its default.

`YieldFrom` global-scope support is type-level only in the current prototype.
When multiple protocols share one runtime scope, output types compose by union
and input types compose by intersection. Prefer explicit scopes when request and
response protocols need tighter correlation.

Common mistake: using the global scope as a catch-all for unrelated exits. A
global-scope handler can catch any exit that uses the same global scope.
