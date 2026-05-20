# Build HTTP Routes

Use this when exposing domain programs through a transport-neutral HTTP server.

```ts
import { assert as assertNoFail, get, fx, ok } from "@briancavalier/fx"
import { route, routes, type RouteContext } from "@briancavalier/fx/http-server"

const appRoutes = routes(
  route("GET", "/health", ok({
    status: 200,
    body: { type: "text", value: "ok" }
  })),

  route("GET", "/users/:id", fx(function* () {
    const { request } = yield* get<RouteContext>()
    const user = yield* findUser(request.params.id)
    return {
      status: user === undefined ? 404 : 200,
      body: { type: "json", value: user ?? { error: "not found" } }
    }
  }))
)
```

Routes describe request handling without choosing the Node HTTP transport.
Use route transforms such as `provideRoutesFrom` to provide request-derived
context to groups of routes.

Handler pipeline:

```ts
serve(appRoutes, { port: 3000 }).pipe(
  appHandlers,
  nodeHttp(),
  assertNoFail,
  runNodeMain
)
```

Common mistake: putting storage, parsing policy, or platform-specific server
logic directly into reusable domain programs instead of keeping it at the route
or transport boundary.
