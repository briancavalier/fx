import { flatMap, fx, runPromise } from '../../src/index.js'
import { get, provide } from '../../src/Env.js'
import { assert as assertNoFail } from '../../src/Fail.js'
import { unbounded } from '../../src/Concurrent.js'
import { console as logConsole, info } from '../../src/Log.js'
import { defaultTime } from '../../src/Time.js'
import { route, serve, type ServerEvent, type ServerListening } from '../../src/HttpServer.js'
import { nodeHttp } from '../../src/HttpServerNode.js'
import { emit, forEach as forEachStream } from '../../src/Stream.js'

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
  flatMap(({ port }) => serve(appRoutes, {
    port,
    observe: event => emit(event)
  }))
)

await server.pipe(
  nodeHttp(),
  f => forEachStream(f, logHttpServerEvent),
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

function logHttpServerEvent(event: ServerEvent) {
  switch (event.type) {
    case 'listening':
      return info('HTTP server ready', addressData(event.address))

    case 'request':
      return info('HTTP request', {
        method: event.method,
        path: event.path,
        status: event.status,
        durationMs: Math.round(event.durationMs)
      })

    case 'requestFailed':
      return info('HTTP request failed', {
        method: event.method,
        path: event.path,
        status: event.status,
        durationMs: Math.round(event.durationMs),
        error: event.error
      })

    case 'closed':
      return info('HTTP server closed')
  }
}

function addressData(address: ServerListening['address']) {
  return address === null
    ? {}
    : { host: address.host, port: address.port }
}
