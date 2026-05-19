# Wrap a Promise

Use this at async platform boundaries such as HTTP, files, databases, and timers.

```ts
import { tryPromise } from "@briancavalier/fx/Async"

const fetchJson = (url: string) =>
  tryPromise(signal =>
    fetch(url, { signal }).then(response => response.json())
  )
```

`tryPromise` converts promise rejection into `Fail<unknown>` and requests the
`Async` effect. The runtime passes an `AbortSignal`; forward it to cancellable
APIs.

Handler pipeline:

```ts
fetchJson("https://example.com/data.json").pipe(
  runPromise
)
```

Common mistake: using `assertPromise` for recoverable platform errors. Use
`assertPromise` only when rejection should crash the program.
