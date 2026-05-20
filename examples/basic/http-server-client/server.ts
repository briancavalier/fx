import { assert as assertNoFail, fx, provide, runPromise } from '@briancavalier/fx'
import { unbounded } from '@briancavalier/fx/concurrent'

import { serve, type ServerEvent, type ServerListening } from '@briancavalier/fx/http-server'
import { nodeHttp } from '@briancavalier/fx/platform-node'
import { info, withConsoleLog } from '@briancavalier/fx/log'
import { brand, forEachFrom, yieldFrom, type Yielding } from '@briancavalier/fx/scope'
import { defaultTime } from '@briancavalier/fx/time'
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
  withConsoleLog,
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
