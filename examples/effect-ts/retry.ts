import { Effect, Fx, flatMap, handle, runPromise, tap } from "../../src"
import { tryPromise } from "../../src/Async"
import { catchAll, fail } from "../../src/Fail"
import { defaultConsole, error, log } from "../../src/Console"

// fx doesn't have a built-in HTTP client, but we can create
// a simple GetJson effect
class GetJson extends Effect("Http")<string, unknown> { }

// and a handler that uses the Fetch API.
const withFetchGetJson = handle(GetJson, (url) =>
  tryPromise(signal =>
    fetch(new URL(url, 'https://jsonplaceholder.typicode.com/'), { signal })
  ).pipe(
    flatMap(r => tryPromise(() => r.json())),
  ))

// We can also create a simple retry handler easily
const retry = (tries: number) => <E, A>(fa: Fx<E, A>): Fx<E, A> =>
  fa.pipe(catchAll((e) =>
    (tries > 1 ? fa.pipe(retry(tries - 1)) : fail(e)) as Fx<E, A>
  ))

// Define findUserById using the new GetJson effect
const findUserById = (id: string) => new GetJson(`/users/${id}`)

const main = findUserById('1').pipe(
  withFetchGetJson,
  retry(3)
)

await main.pipe(
  tap(user => log('Got user', user)),
  catchAll(e => error(`Error fetching user`, { error: e })),
  defaultConsole,
  runPromise
)
