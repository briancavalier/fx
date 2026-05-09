import { flatMap, fx, runPromise, tap } from '../../src/index.js'
import { get, provide } from '../../src/Env.js'
import { assert as assertNoFail } from '../../src/Fail.js'
import { unbounded } from '../../src/Concurrent.js'
import { console as logConsole, info } from '../../src/Log.js'
import { defaultTime } from '../../src/Time.js'
import { route, serve } from '../../src/HttpServer.js'
import { nodeHttp } from '../../src/HttpServerNode.js'

import { next } from './counter.js'
import { mapCounter } from './counter-map.js'
//import { keyvCounter } from './counter-keyv.js'

// ----------------------------------------------------------------------
// Define the routes

const appRoutes = route('GET', '/*', request => fx(function* () {
  const key = request.path
  const value = yield* next(key)

  yield* info('Incremented', { key, value })

  return {
    status: 200,
    body: { type: 'json', value: { key, value } }
  }
}))

// ----------------------------------------------------------------------
// #region Run the server

const port = Number(process.env.PORT ?? process.env.port ?? 3000)

const server = get<{ port: number }>().pipe(
  tap(({ port }) => info('Listening on port', { port })),
  flatMap(({ port }) => serve(appRoutes, { port }))
)

await server.pipe(
  nodeHttp(),
  mapCounter,
  logConsole,
  defaultTime,
  assertNoFail,
  provide({ port }),
  // keyvCounter,
  unbounded,
  runPromise
)

//#endregion
