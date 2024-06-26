import { Env, Fork, Log, fx, runPromise } from '../../src'

import { Request, runServer } from './HttpServer'
import { next } from './counter'
import { mapCounter } from './counter-map'
//import { keyvCounter } from './counter-keyv'

// ----------------------------------------------------------------------
// Define the handler for requests

const myHandler = (r: Request) => fx(function* () {
  const key = r.url ?? ''
  const value = yield* next(key)

  yield* Log.info('Incremented', { key, value })

  return {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value })
  }
})

// ----------------------------------------------------------------------
// #region Run the server

const { port = 3000 } = process.env

runServer(myHandler).pipe(
  Log.console,
  Env.provide({ port: +port }),
  mapCounter, // Use an in-memory Map for the counters
  // keyvCounter, // uncomment to use keyvCounter with durable storage
  // Fail.assert, // keyvCounter uses a database, so has additional failure modes
  Fork.unbounded,
  runPromise
)

//#endregion
