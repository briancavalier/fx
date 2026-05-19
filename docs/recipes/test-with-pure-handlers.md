# Test with Pure Handlers

Use this when testing domain logic without real platform dependencies.

```ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { handle, ok, run } from "@briancavalier/fx"

test("loads a user", () => {
  const program = loadGreeting("user-1").pipe(
    handle(FindUser, () => ok({ id: "user-1", name: "Ada" })),
    run
  )

  assert.equal(program, "Hello, Ada")
})
```

Pure handlers make the effect boundary explicit and keep tests deterministic.

Handler pipeline:

```ts
domainProgram.pipe(
  handle(AppEffect, () => ok(testValue)),
  run
)
```

Common mistake: testing domain programs by calling real HTTP, databases, clocks,
or random number generators when a local handler would express the case more
clearly.
