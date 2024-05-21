import { IncomingMessage, ServerResponse, createServer } from 'http'

import { Effect, Env, Fork, Fx, Log, Stream, bracket, fx, ok } from '../../src'

//----------------------------------------------------------------------
// Http Server example
// This shows the flexibility of handlers.  We can implement an http
// server as a handler.  This implementation ignores errors and other
// details, but it's a good example of what handlers are capable of.

// #region Http Server effect to get the next incoming request

class NextRequest extends Effect('HttpServer')<void, Connection> { }

export const nextRequest = new NextRequest()

export type Connection = Readonly<{ request: IncomingMessage; response: ServerResponse }>

export type Request = Readonly<{ method: string; url: string }>
export type Response = Readonly<{ status: number; headers: Record<string, string>; body: string }>

// #endregion
// ----------------------------------------------------------------------
// #region Node Http Server handler
// Runs a node server as a handler, with bracket to manage
// the server lifecycle

export const serveNode = bracket(
  fx(function* () {
    const { port } = yield* Env.get<{ port: number }>()
    return createServer().listen(port)
  }),
  server => ok(void server.close()),
  server => Stream.withEmitter<Connection>(emitter => {
    server.on('request', (request, response) => emitter.event({ request, response }))
    return {
      [Symbol.dispose]() {
        emitter.end()
      }
    }
  })
)

export const runServer = <E>(
  handleRequest: (c: Request) => Fx<E, Response>
) => Stream.forEach(serveNode, ({ request, response }) => fx(function* () {
  yield* Fork.fork(fx(function* () {
    const r = yield* handleRequest({ method: 'GET', url: '', ...request })
    yield* Log.info('Handled request', { method: request.method, url: request.url, status: r.status })
    response.writeHead(r.status, r.headers).end(r.body)
  }))
}))
