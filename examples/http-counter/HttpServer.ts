import { IncomingMessage, ServerResponse, createServer } from 'http'

import { Fx, bracket, fx, ok } from '../../src'
import { get } from '../../src/Env'
import { fork } from '../../src/Fork'
import { info } from '../../src/Log'
import { forEach, withEnqueue } from '../../src/Stream'
//----------------------------------------------------------------------
// Http Server example
// This shows the flexibility of handlers.  We can implement an http
// server as a handler.  This implementation ignores errors and other
// details, but it's a good example of what handlers are capable of.

export type Connection = Readonly<{ request: IncomingMessage; response: ServerResponse }>

export type Request = Readonly<{ method: string; url: string }>
export type Response = Readonly<{ status: number; headers: Record<string, string>; body: string }>

// #endregion
// ----------------------------------------------------------------------
// #region Node Http Server as a Stream of Connections

export const httpServer = bracket(
  fx(function* () {
    const { port } = yield* get<{ port: number }>()
    const server = createServer().listen(port)
    yield* info(`Listening on port ${port}`)
    return server
  }),
  server => ok(void server.close()),
  server => withEnqueue<Connection>(q => {
    server.on('request', (request, response) => q.enqueue({ request, response }))
    return q
  })
)

// #endregion
// ----------------------------------------------------------------------
// #region handler to run the server by consuming the Stream of
// Connections, and forking handleRequest for each.

export const runServer = <E>(
  handleRequest: (r: Request) => Fx<E, Response>
) => forEach(httpServer, ({ request, response }) => fx(function* () {
  yield* fork(fx(function* () {
    const r = yield* handleRequest({ method: 'GET', url: '', ...request })
    yield* info('Handled request', { method: request.method, url: request.url, status: r.status })
    response.writeHead(r.status, r.headers).end(r.body)
  }))
}))
