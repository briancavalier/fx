import { fx, runPromise } from '../../../src/index.js'
import { unbounded } from '../../../src/Concurrent.js'
import { provide } from '../../../src/Env.js'
import { assert as assertNoFail } from '../../../src/Fail.js'
import { serve, type ServerEvent, type ServerListening } from '../../../src/HttpServer.js'
import { nodeHttp } from '../../../src/HttpServerNode.js'
import { console as logConsole, info } from '../../../src/Log.js'
import { brand } from '../../../src/Scope.js'
import { defaultTime } from '../../../src/Time.js'
import { forEachFrom, yieldFrom, type Yielding } from '../../../src/YieldFrom.js'
import { appRoutes, memoryNotes } from './api.js'

type ServerConfig = {
  readonly port: number
}

const HttpServerEvents = brand<Yielding<ServerEvent>>()('examples/basic/http-server-client/HttpServerEvents')

const server = fx(function* ({ port }: ServerConfig) {
  return yield* serve(appRoutes, {
    host: '127.0.0.1',
    port,
    observe: event => yieldFrom(HttpServerEvents, event)
  })
})

await server.pipe(
  nodeHttp(),
  f => forEachFrom(HttpServerEvents, f, logHttpServerEvent),
  memoryNotes(),
  logConsole,
  defaultTime,
  assertNoFail,
  provide({ port: Number(process.env.PORT ?? 3000) }),
  unbounded,
  runPromise
)

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
