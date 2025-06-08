import { Async, Effect, Fail, Fork, Fx, Log, handle, runTask, tap } from "../../src"

// Fx doesn't have a built-in HTTP client, but we can create
// a simple GetJson effect and a handler that uses the Fetch API.
class GetJson extends Effect("Http")<string, unknown> { }

const getJson = (url: string) => new GetJson(url)

const withFetchGetJson = handle(GetJson, (url) =>
  Async.tryPromise(signal =>
    fetch(new URL(url, 'https://jsonplaceholder.typicode.com/'), { signal })
      .then(res => res.ok
        ? res.json()
        : Promise.reject(new Error(`Failed to fetch ${url}: ${res.statusText}`)))
  )
)

// We can also create a simple retry handler easily
const retry = (tries: number) => <E, A>(fa: Fx<E, A>): Fx<E, A> =>
  fa.pipe(Fail.catchAll((e) =>
    (tries === 0 ? Fail.fail(e) : fa.pipe(retry(tries - 1))) as Fx<E, A>
  ))

// Define findUserById function that using the new GetJson effect
const findUserById = (id: string) => getJson(`/users/${id}`)

const main = findUserById("1").pipe(
  tap(user => Log.info(`Got user`, { user })),
).pipe(
  withFetchGetJson,
  retry(3)
)

main.pipe(
  Fail.catchAll(e => Log.error(`Error fetching user: ${e}`)),
  Log.console,
  Fork.unbounded,
  runTask
)
