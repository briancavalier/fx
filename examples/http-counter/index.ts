import { Env, Fork, Log, Time, fx, runAsync } from '../../src'

import { Request, runServer } from './HttpServer'
import { increment } from './counter'
import { mapCounter } from './counter-map'

// ----------------------------------------------------------------------
// Define the handler for requests

const myHandler = (r: Request) => fx(function* () {
  const key = r.url ?? ''
  const value = yield* increment(key)

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
  Time.builtinDate,
  Env.provide({ port: +port }),
  mapCounter,
  Fork.unbounded,
  runAsync
)

//#endregion
