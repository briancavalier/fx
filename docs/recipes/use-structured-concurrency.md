# Use Structured Concurrency

Use this when related child computations should be owned by the parent.

```ts
import { fx, runPromise } from "@briancavalier/fx"
import { all, bounded, defaultAll } from "@briancavalier/fx/concurrent"

const loadDashboard = fx(function* () {
  const [user, posts] = yield* all([
    fetchUser,
    fetchPosts
  ])

  return { user, posts }
})
```

`all` describes the request. `defaultAll` chooses the default structured
semantics, and `bounded` or `unbounded` chooses fork scheduling.

Handler pipeline:

```ts
loadDashboard.pipe(
  defaultAll,
  bounded(4),
  runPromise
)
```

Use `race` with `firstSettled` for first-settled semantics, or `firstSuccess`
when failures should be ignored until every child fails.

Common mistake: using raw promises for child work that should be cancelled or
disposed when the parent fails.
