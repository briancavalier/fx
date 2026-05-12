import { IncomingMessage, ServerResponse as NodeServerResponse, createServer } from 'node:http'
import { Readable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { Async, tryPromise } from './Async.js'
import { Fail, catchAll, fail, returnFail, returnAll } from './Fail.js'
import { Fx, assertSync, bracket, flatMap, flatten, fx, ok, runPromise, trySync, unit } from './Fx.js'
import { Handle } from './Handler.js'
import { type Headers, type Method } from './HttpClient.js'
import {
  CompiledRoutes,
  Serve,
  ServeOptions,
  ServeRequest,
  ServeScope,
  ServerAddress,
  ServerEvent,
  ServerRequest,
  ServerResponse,
  compileRoutes,
  dispatch
} from './HttpServer.js'
import { HandlerCapture, handleCaptured, withCapturedHandlers, withHandlerContext } from './HandlerCapture.js'
import * as Queue from './internal/Queue.js'

export type NodeHttpOptions = {
  readonly createServer?: NodeHttpServerFactory
}

export type NodeHttpServerFactory =
  (listener: NodeRequestListener) => NodeHttpServer

export type NodeRequestListener =
  (request: IncomingMessage, response: NodeServerResponse) => void

export type NodeHttpServer = {
  listen(port: number, host: string | undefined, callback: () => void): unknown
  close(callback: (error?: Error) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  off?(event: 'error', listener: (error: Error) => void): unknown
  address?(): NodeListenAddress | string | null
}

export type NodeListenAddress = {
  readonly address: string
  readonly family: string
  readonly port: number
}

/**
 * Failure raised when the Node HTTP server cannot accept or write a request.
 */
export class NodeHttpError extends Error {
  readonly name = 'NodeHttpError'
}

export const nodeHttp = ({
  createServer: makeServer = createServer
}: NodeHttpOptions = {}) =>
  <const E, const A>(f: Fx<E, A>): Fx<NodeHttpHandled<E>, A> =>
    withCapturedHandlers(ServeScope, f).pipe(
      flatMap(fx =>
        ok(fx.pipe(handleCaptured(ServeScope, Serve, serve => runNodeServer(serve.arg, makeServer))))
      ),
      flatten
    ) as Fx<NodeHttpHandled<E>, A>

export type NodeHttpHandled<E> =
  Handle<Handle<E, Serve<any, any>, Async | Fail<NodeHttpError>>, HandlerCapture<typeof ServeScope>>
  | HandlerCapture<typeof ServeScope>

const runNodeServer = <E, OE>(
  request: ServeRequest<E, OE>,
  createServer: NodeHttpServerFactory
): Fx<OE | Async | Fail<NodeHttpError>, void> => {
  const compiled = compileRoutes(request.routes)
  const observe = request.options.observe ?? ignoreServerEvent as (event: ServerEvent) => Fx<OE, void>

  return bracket(
    assertSync(() => new Queue.UnboundedQueue<ServerInternalEvent>()),
    events => ok(events[Symbol.dispose]()),
    events => bracket(
      startNodeServer(request.options, createServer, events, (incoming, outgoing) => {
        void runNodeRequest(compiled, request.context, events, incoming, outgoing)
      }),
      server => closeNodeServer(server).pipe(
        flatMap(() => observe({ type: 'closed', timestamp: eventTimestamp() }))
      ),
      server => drainNodeHttpEvents(events, server, observe)
    )
  ).pipe(
    flatMap(rethrowObservedFail)
  ) as Fx<OE | Async | Fail<NodeHttpError>, void>
}

type ServerInternalEvent =
  | ServerEvent
  | { readonly type: 'error'; readonly error: Error }

type StartedNodeHttpServer = {
  readonly server: NodeHttpServer
  readonly cleanup: () => void
}

const startNodeServer = (
  options: ServeOptions<any>,
  createServer: NodeHttpServerFactory,
  events: Queue.Enqueue<ServerInternalEvent>,
  listener: NodeRequestListener
): Fx<Async | Fail<NodeHttpError>, StartedNodeHttpServer> =>
  tryPromise(signal => new Promise<StartedNodeHttpServer>((resolve, reject) => {
    const server = createServer(listener)
    let listening = false
    let closed = false
    const onError = (error: Error) => {
      if (listening) {
        events.enqueue({ type: 'error', error })
        return
      }
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      if (closed) return
      closed = true
      cleanup()
      server.close(error => error ? reject(error) : resolve({ server, cleanup }))
    }
    const cleanup = () => {
      server.off?.('error', onError)
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort)
    server.on('error', onError)
    server.listen(options.port, options.host, () => {
      listening = true
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) {
        onAbort()
        return
      }
      events.enqueue({
        type: 'listening',
        timestamp: eventTimestamp(),
        address: toServerAddress(server.address?.() ?? null)
      })
      resolve({ server, cleanup })
    })

    if (!listening && signal.aborted) onAbort()
  })).pipe(
    catchAll(failNodeHttp('Node HTTP server failed'))
  )

const closeNodeServer = (
  started: StartedNodeHttpServer
): Fx<Async | Fail<NodeHttpError>, void> =>
  tryPromise(() => new Promise<void>((resolve, reject) => {
    started.cleanup()
    started.server.close(error => error ? reject(error) : resolve())
  })).pipe(
    catchAll(failNodeHttp('Node HTTP server failed'))
  )

const drainNodeHttpEvents = <E>(
  events: Queue.Dequeue<ServerInternalEvent>,
  server: StartedNodeHttpServer,
  observe: (event: ServerEvent) => Fx<E, void>
): Fx<Exclude<E, Fail<any>> | Async | Fail<NodeHttpError>, void | Extract<E, Fail<any>>> => fx(function* () {
    const dequeue = dequeueNodeHttpEvent(events, server)

    while (!events.disposed) {
      const next = yield* dequeue
      if (next.tag === 'fx/Queue/Disposed') return

      if (next.value.type === 'error') {
        return yield* failNodeHttp('Node HTTP server failed')(next.value.error)
      }

      const observed = yield* observe(next.value).pipe(returnFail)
      if (Fail.is(observed)) return observed
    }
  })

const dequeueNodeHttpEvent = (
  events: Queue.Dequeue<ServerInternalEvent>,
  started: StartedNodeHttpServer
): Fx<Async | Fail<NodeHttpError>, Queue.Dequeued<ServerInternalEvent> | Queue.Disposed> =>
  tryPromise(signal => new Promise<Queue.Dequeued<ServerInternalEvent> | Queue.Disposed>((resolve, reject) => {
    let settled = false
    const done = (next: Queue.Dequeued<ServerInternalEvent> | Queue.Disposed) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(next)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      started.cleanup()
      events[Symbol.dispose]()
      started.server.close(error =>
        error ? reject(error) : resolve({ tag: 'fx/Queue/Disposed' } as Queue.Disposed)
      )
    }

    signal.addEventListener('abort', onAbort)
    void events.dequeue().then(done, reject)
    if (signal.aborted) onAbort()
  })).pipe(
    catchAll(failNodeHttp('Node HTTP server failed'))
  )

const runNodeRequest = async <E>(
  compiled: CompiledRoutes<E>,
  context: ServeRequest<E>['context'],
  events: Queue.Enqueue<ServerInternalEvent>,
  incoming: IncomingMessage,
  outgoing: NodeServerResponse
): Promise<void> => {
  const request = toServerRequest(incoming)
  const start = performance.now()
  let status = 500
  let failure: { readonly error: unknown } | undefined

  const program = fx(function* () {
    const response = yield* dispatch(compiled, request)
    status = response.status
    yield* writeNodeResponse(outgoing, response)
  })

  try {
    await withHandlerContext(context, program as Fx<unknown, void>).pipe(
      catchAll(cause => {
        failure = { error: cause }
        return writeInternalServerError(outgoing)
      }),
      returnAll,
      f => runPromise(f as Fx<Async | HandlerCapture<string>, void>)
    )
  } catch (cause) {
    failure ??= { error: cause }
    outgoing.destroy()
  } finally {
    const durationMs = performance.now() - start
    const finalStatus = outgoing.headersSent ? outgoing.statusCode : status
    const event = failure ? {
      type: 'requestFailed' as const,
      timestamp: eventTimestamp(),
      method: request.method,
      path: request.path,
      status: finalStatus,
      durationMs,
      error: failure.error
    } : {
      type: 'request' as const,
      timestamp: eventTimestamp(),
      method: request.method,
      path: request.path,
      status: finalStatus,
      durationMs
    }

    events.enqueue(event)
  }
}

const writeInternalServerError = (
  response: NodeServerResponse
): Fx<Async | Fail<NodeHttpError>, void> =>
  response.headersSent
    ? end(response)
    : writeNodeResponse(response, {
      status: 500,
      headers: [['content-type', 'text/plain; charset=utf-8']],
      body: { type: 'text', value: 'Internal Server Error' }
    })

const eventTimestamp = (): number =>
  Date.now()

const toServerRequest = (request: IncomingMessage): ServerRequest => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  return {
    method: toMethod(request.method),
    url,
    path: url.pathname,
    query: url.searchParams,
    headers: toHeaders(request.headers),
    body: toReadableStream(request),
    params: {}
  }
}

const toMethod = (method: string | undefined): Method =>
  isMethod(method) ? method : 'GET'

const isMethod = (method: string | undefined): method is Method =>
  method === 'GET'
  || method === 'POST'
  || method === 'PUT'
  || method === 'PATCH'
  || method === 'DELETE'
  || method === 'HEAD'
  || method === 'OPTIONS'

const toHeaders = (headers: IncomingMessage['headers']): Headers =>
  Object.entries(headers).flatMap(([name, value]) =>
    value === undefined
      ? []
      : Array.isArray(value)
        ? value.map(v => [name, v] as const)
        : [[name, value] as const]
  )

const toReadableStream = (request: IncomingMessage): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      request.on('data', chunk => controller.enqueue(toUint8Array(chunk)))
      request.on('end', () => controller.close())
      request.on('error', error => controller.error(error))
    },
    cancel() {
      request.destroy()
    }
  })

const writeNodeResponse = <E>(
  response: NodeServerResponse,
  serverResponse: ServerResponse<E>
): Fx<E | Async | Fail<NodeHttpError>, void> => fx(function* () {
    const body = serverResponse.body ?? { type: 'empty' }
    response.writeHead(serverResponse.status, headersFor(serverResponse.headers, body.type))

    switch (body.type) {
      case 'empty':
        return yield* end(response)

      case 'text':
        return yield* end(response, body.value)

      case 'json': {
        return yield* trySync(() => JSON.stringify(body.value)).pipe(
          catchAll(failNodeHttp('Failed to encode JSON response body')),
          flatMap(value => end(response, value))
        )
      }

      case 'bytes':
        return yield* end(response, body.value)

      case 'stream':
        return yield* writeReadable(response, body.value)
    }
  })

const headersFor = (
  headers: ServerResponse['headers'],
  bodyType: NonNullable<ServerResponse['body']>['type']
) =>
  Object.fromEntries(hasHeader(headers, 'content-type') || bodyType !== 'json'
    ? headers ?? []
    : [['content-type', 'application/json'], ...(headers ?? [])])

const hasHeader = (headers: ServerResponse['headers'], name: string): boolean =>
  headers?.some(([headerName]) => headerName.toLowerCase() === name) ?? false

const writeReadable = (
  response: NodeServerResponse,
  body: ReadableStream<Uint8Array>
): Fx<Async | Fail<NodeHttpError>, void> =>
  tryPromise(() =>
    pipeline(
      Readable.fromWeb(body),
      response
    )
  ).pipe(
    catchAll(failNodeHttp('Failed to write response stream'))
  )

const end = (
  response: NodeServerResponse,
  body?: string | Uint8Array
): Fx<Async | Fail<NodeHttpError>, void> =>
  tryPromise(() => {
    response.end(body)
    return finished(response, { cleanup: true })
  }).pipe(
    catchAll(failNodeHttp('Failed to finish response'))
  )

const failNodeHttp = (message: string) =>
  <E>(cause: E) => fail(new NodeHttpError(message, { cause }))

const ignoreServerEvent = (_event: ServerEvent): Fx<never, void> => unit

const toServerAddress = (address: NodeListenAddress | string | null): ServerAddress | null =>
  address === null || typeof address === 'string'
    ? null
    : { host: address.address, port: address.port }

const rethrowObservedFail = <E>(
  result: void | Extract<E, Fail<any>>
): Fx<E, void> =>
  Fail.is(result) ? result as unknown as Fx<E, void> : unit as Fx<E, void>

const toUint8Array = (chunk: unknown): Uint8Array =>
  chunk instanceof Uint8Array
    ? chunk
    : new Uint8Array(Buffer.from(String(chunk)))
