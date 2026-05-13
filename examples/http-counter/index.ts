import { fx, runPromise } from '../../src/index.js'
import { provide } from '../../src/Env.js'
import { assert as assertNoFail } from '../../src/Fail.js'
import { unbounded } from '../../src/Concurrent.js'
import { console as logConsole, info } from '../../src/Log.js'
import { defaultTime } from '../../src/Time.js'
import { route, serve, type RouteContext, type ServerEvent, type ServerListening } from '../../src/HttpServer.js'
import { nodeHttp } from '../../src/HttpServerNode.js'
import { emit, forEach as forEachStream } from '../../src/Stream.js'

import { next } from './counter.js'
import { mapCounter } from './counter-map.js'
//import { keyvCounter } from './counter-keyv.js'

// ----------------------------------------------------------------------
// Define the routes

const appRoutes = route('GET', '/*', fx(function* ({ request }: RouteContext) {
  const key = request.path
  const value = yield* next(key)

  yield* info('Incremented', { key, value })

  return {
    status: 200,
    body: { type: 'json' as const, value: { key, value } }
  }
}))

// ----------------------------------------------------------------------
// #region Run the server

const port = Number(process.env.PORT ?? process.env.port ?? 3000)

const server = fx(function* ({ port }: { readonly port: number }) {
  return yield* serve(appRoutes, {
    port,
    observe: event => emit(event)
  })
})

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
      return info('HTTP server ready', {
        timestamp: event.timestamp,
        ...addressData(event.address)
      })

    case 'request':
      return info('HTTP request', {
        timestamp: event.timestamp,
        method: event.method,
        path: event.path,
        status: event.status,
        durationMs: Math.round(event.durationMs)
      })

    case 'requestFailed':
      return info('HTTP request failed', {
        timestamp: event.timestamp,
        method: event.method,
        path: event.path,
        status: event.status,
        durationMs: Math.round(event.durationMs),
        error: event.error
      })

    case 'closed':
      return info('HTTP server closed', { timestamp: event.timestamp })
  }
}

function addressData(address: ServerListening['address']) {
  return address === null
    ? {}
    : { host: address.host, port: address.port }
}
