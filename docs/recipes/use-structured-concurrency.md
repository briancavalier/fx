# Use Structured Concurrency

Use this when related child computations should be owned by the parent.

```ts
import { fx, runPromise } from "@briancavalier/fx"
import { all, withBoundedConcurrency } from "@briancavalier/fx/concurrent"

const loadDashboard = fx(function* () {
  const [user, posts] = yield* all([
    fetchUser,
    fetchPosts
  ])

  return { user, posts }
})
```

`all` describes the structured operator. The scheduler handler chooses the
execution strategy:
`withBoundedConcurrency`, `withUnboundedConcurrency`, or `withCoopConcurrency`.

Handler pipeline:

```ts
loadDashboard.pipe(
  withBoundedConcurrency(4),
  runPromise
)
```

Use `race` for first-settled semantics, or `firstSuccess` when failures should
be ignored until every child fails. Then choose an execution strategy handler
for the race.

Common mistake: using raw promises for child work that should be cancelled or
disposed when the parent fails.
