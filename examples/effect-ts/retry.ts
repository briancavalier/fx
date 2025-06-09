import { Async, Effect, Fail, Fork, Fx, Log, handle, runTask, tap } from "../../src"

// fx doesn't have a built-in HTTP client, but we can create
// a simple GetJson effect
class GetJson extends Effect("Http")<string, unknown> { }

// and a handler that uses the Fetch API.
const withFetchGetJson = handle(GetJson, (url) =>
  Async.tryPromise(signal =>
    fetch(new URL(url, 'https://jsonplaceholder.typicode.com/'), { signal })
      .then(res => res.ok
        ? res.json()
        : Promise.reject(new Error(`Failed to fetch ${url}: ${res.statusText}`)))
  ))

// We can also create a simple retry handler easily
const retry = (tries: number) => <E, A>(fa: Fx<E, A>): Fx<E, A> =>
  fa.pipe(Fail.catchAll((e) =>
    (tries > 1 ? fa.pipe(retry(tries - 1)) : Fail.fail(e)) as Fx<E, A>
  ))

// Define findUserById using the new GetJson effect
const findUserById = (id: string) => new GetJson(`/users/${id}`)

const main = findUserById('123').pipe(
  withFetchGetJson,
  retry(3)
)

main.pipe(
  tap(user => Log.info('Got user', { user })),
  Fail.catchAll(error => Log.error(`Error fetching user`, { error })),
  Log.console,
  Fork.unbounded,
  runTask
)
