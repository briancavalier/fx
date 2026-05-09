import { runPromise } from '../../src/index.js'
import { unbounded } from '../../src/Concurrent.js'
import { get, provide } from '../../src/Env.js'
import { assert as assertNoFail } from '../../src/Fail.js'
import { flatMap, tap } from '../../src/Fx.js'
import { serve } from '../../src/HttpServer.js'
import { nodeHttp } from '../../src/HttpServerNode.js'
import { console as logConsole, info } from '../../src/Log.js'
import { defaultTime } from '../../src/Time.js'
import { appRoutes, memoryNotes } from './api.js'

type ServerConfig = {
  readonly port: number
}

const server = get<ServerConfig>().pipe(
  tap(({ port }) => info('HTTP server ready', { host: '127.0.0.1', port })),
  flatMap(({ port }) => serve(appRoutes, { host: '127.0.0.1', port }))
)

await server.pipe(
  nodeHttp(),
  memoryNotes(),
  logConsole,
  defaultTime,
  assertNoFail,
  provide({ port: Number(process.env.PORT ?? 3000) }),
  unbounded,
  runPromise
)
