import { flatMap, runPromise, setTraceCapturePolicy, tap } from "../../src/index.js"
import { defaultConsole, error, log } from "../../src/Console.js"
import { catchAll } from "../../src/Fail.js"
import { expectSuccess, json, request, w3cFetch } from "../../src/HttpClient.js"
import { defaultRetry, retry } from "../../src/Retry.js"
import { formatDiagnostic } from '../../src/Trace.js'
import { nodeSourceLookup } from '../../src/TraceNode.js'

setTraceCapturePolicy('full')

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
  catchAll(e => error(`Error fetching user`, formatDiagnostic(e, { source: { lookup: nodeSourceLookup() } }))),
  defaultConsole,
  runPromise
)
