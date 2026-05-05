import { flatMap, runPromise, tap } from "../../src"
import { defaultConsole, error, log } from "../../src/Console"
import { catchAll } from "../../src/Fail"
import { expectSuccess, json, request, w3cFetch } from "../../src/HttpClient"
import { defaultRetry, retry } from "../../src/Retry"

const findUserById = (id: number) => request({
  url: new URL(`https://jsonplaceholderx.typicode.com/users/${id}`)
}).pipe(
  flatMap(expectSuccess),
  flatMap(json)
)

const main = findUserById(1).pipe(
  retry({ retries: 3 }),
  tap(user => log('Got user', user)),
)

await main.pipe(
  w3cFetch(),
  // defaultRetry(), // without attempt logging
  defaultRetry({ // with attempt logging
    observe: event => log(`Attempt ${event.attempt}`, event)
  }),
  catchAll(e => error(`Error fetching user`, e)),
  defaultConsole,
  runPromise
)
