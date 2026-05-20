# Run a Node Program

Use this for Node entrypoints that should run async `Fx` programs and shut down
cleanly on process signals.

```ts
import { runNodeMain } from "@briancavalier/fx/platform-node"
import { defaultConsole } from "@briancavalier/fx/log"

const main = program.pipe(
  defaultConsole
)

await runNodeMain(main)
```

Use `runPromise` when the caller owns shutdown policy. Use `runNodeMain` when
the entrypoint should install signal handlers for `SIGINT` and `SIGTERM`.

Handler pipeline:

```ts
program.pipe(
  appHandlers,
  platformHandlers,
  effect => runNodeMain(effect)
)
```

Common mistake: running a program before all non-runtime effects have been
handled. Leave only runtime-supported effects such as `Async`, `Interrupt`, and
handler capture for the runner.
