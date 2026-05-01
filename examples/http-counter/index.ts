import { fx, runPromise } from '../../src'
import { provide } from '../../src/Env'
import { unbounded } from '../../src/Fork'
import { console as logConsole, info } from '../../src/Log'
import { defaultTime } from '../../src/Time'

import { Request, runServer } from './HttpServer'
import { next } from './counter'
import { mapCounter } from './counter-map'
//import { keyvCounter } from './counter-keyv'

// ----------------------------------------------------------------------
// Define the handler for requests

const myHandler = (r: Request) => fx(function* () {
  const key = r.url ?? ''
  const value = yield* next(key)

  yield* info('Incremented', { key, value })

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
  logConsole,
  defaultTime,
  provide({ port: +port }),
  mapCounter,
  // keyvCounter,
  unbounded,
  runPromise
)

//#endregion
