import { IncomingMessage, Server, ServerResponse, createServer } from 'http'

import { Async, Effect, Env, Fork, Fx, bracket, fx, handle, ok } from '../../src'

//----------------------------------------------------------------------
// Http Server example
// This shows the flexibility of handlers.  We can implement an http
// server as a handler.  This implementation ignores errors and other
// details, but it's a good example of what handlers are capable of.

// #region Http Server effect to get the next incoming request

class NextRequest extends Effect('HttpServer')<void, Connection> { }

export const nextRequest = new NextRequest()

export type Connection = Readonly<{ request: IncomingMessage; response: ServerResponse }>

// #endregion
// ----------------------------------------------------------------------
// #region Node Http Server handler
// Runs a node server as a handler, with initially/finally to manage
// the server lifecycle

export const serveNode = <E, A>(f: Fx<E, A>) => bracket(
  fx(function*() {
    const { port } = yield* Env.get<{ port: number }>()
    return createServer().listen(port)
  }),
  server => ok(void server.close()),
  server => f.pipe(
    handle(NextRequest, () => {
      const close = () => server.close()

      return Async.run((signal) => {
        signal.addEventListener('abort', close, { once: true })
        return getNextRequest(server)
          .finally(() => signal.removeEventListener('abort', close))
      })
    })
  )
)

export const runServer = <E, A>(
  handleRequest: (c: Connection) => Fx<E, A>
) => serveNode(fx(function* () {
  while(true) {
    const next = yield* nextRequest
    yield* Fork.fork(handleRequest(next))
  }
}))

const getNextRequest = (server: Server) =>
  new Promise<{ request: IncomingMessage; response: ServerResponse}>((resolve) =>
    server.once("request", (request, response) =>
      resolve({ request, response })))

// #endregion
