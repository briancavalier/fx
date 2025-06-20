import { Async, Console, Effect, Fail, Fx, flatMap, handle, runPromise, tap } from "../../src"

// fx doesn't have a built-in HTTP client, but we can create
// a simple GetJson effect
class GetJson extends Effect("Http")<string, unknown> { }

// and a handler that uses the Fetch API.
const withFetchGetJson = handle(GetJson, (url) =>
  Async.tryPromise(signal =>
    fetch(new URL(url, 'https://jsonplaceholder.typicode.com/'), { signal })
  ).pipe(
    flatMap(r => Async.tryPromise(() => r.json())),
  ))

// We can also create a simple retry handler easily
const retry = (tries: number) => <E, A>(fa: Fx<E, A>): Fx<E, A> =>
  fa.pipe(Fail.catchAll((e) =>
    (tries > 1 ? fa.pipe(retry(tries - 1)) : Fail.fail(e)) as Fx<E, A>
  ))

// Define findUserById using the new GetJson effect
const findUserById = (id: string) => new GetJson(`/users/${id}`)

const main = findUserById('1').pipe(
  withFetchGetJson,
  retry(3)
)

main.pipe(
  tap(user => Console.log('Got user', user)),
  Fail.catchAll(error => Console.error(`Error fetching user`, { error })),
  Console.defaultConsole,
  runPromise
)
