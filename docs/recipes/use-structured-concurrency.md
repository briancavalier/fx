# Use Structured Concurrency

Use this when related child computations should be owned by the parent.

```ts
import { fx, runPromise } from "@briancavalier/fx"
import {
  all,
  forkIn,
  withBoundedConcurrency,
  withUnboundedConcurrency
} from "@briancavalier/fx/concurrent"
import { scope, withScope } from "@briancavalier/fx/scope"

const loadDashboard = fx(function* () {
  const [user, posts] = yield* all([
    fetchUser,
    fetchPosts
  ])

  return { user, posts }
})
```

`all` describes the structured operator. The scheduler handler chooses when
forks run:
`withBoundedConcurrency` or `withUnboundedConcurrency`.

Experimental cooperative scheduling is available from a separate subpath:

```ts
import { withCoopConcurrency } from "@briancavalier/fx/experimental/concurrent"
```

Handler pipeline:

```ts
loadDashboard.pipe(
  withBoundedConcurrency(4),
  runPromise
)
```

Use `race` for first-settled semantics, or `firstSuccess` when failures should
be ignored until every child fails. Then choose a scheduler handler for the
race.

## Scope-owned forks

Use `forkIn(scope, fx)` when child lifetime should belong to a named scope, but
scheduling should still be chosen by the nearest concurrency handler.

```ts
const RequestScope = scope("request")

const request = fx(function* () {
  yield* forkIn(RequestScope, refreshCache)
  return yield* loadDashboard
})
```

`forkIn` introduces a scoped fork effect. `withScope(RequestScope)` handles that
lifetime boundary and re-yields an ordinary `Fork` scheduling request. A fork
scheduler must be outside the scope to handle that request:

```ts
request.pipe(
  withScope(RequestScope),
  withUnboundedConcurrency,
  runPromise
)
```

This follows the normal fx rule that handlers eliminate effects. Reversing the
order leaves the generated `Fork` unhandled, so normal typed execution should
reject it:

```ts
request.pipe(
  withUnboundedConcurrency,
  withScope(RequestScope),
  runPromise
)
```

Scope-owned forks are not an ambient runtime fiber registry. They are explicit
effects handled by a matching scope boundary and scheduled by an outer fork
scheduler such as `withBoundedConcurrency` or `withUnboundedConcurrency`.
For experimental cooperative scheduling, import `withCoopConcurrency` from
`@briancavalier/fx/experimental/concurrent`.

For a runnable example with scoped child work, a scope deadline, and cleanup,
see `examples/intermediate/scope-owned-forks.ts`.

Common mistake: using raw promises for child work that should be cancelled or
disposed when the parent fails.
