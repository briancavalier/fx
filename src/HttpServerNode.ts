import { IncomingMessage, ServerResponse as NodeServerResponse, createServer } from 'node:http'
import { Readable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { Async, tryPromise } from './Async.js'
import { Fail, catchAll, fail } from './Fail.js'
import { Fx, flatMap, flatten, fx, ok, runPromise, trySync } from './Fx.js'
import { Handle } from './Handler.js'
import { type Headers, type Method } from './HttpClient.js'
import {
  CompiledRoutes,
  Serve,
  ServeRequest,
  ServeScope,
  ServerRequest,
  ServerResponse,
  compileRoutes,
  dispatch
} from './HttpServer.js'
import { Scoped, handleScoped, scoped, withContext } from './Scoped.js'

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
    scoped(ServeScope, f).pipe(
      flatMap(fx =>
        ok(fx.pipe(handleScoped(ServeScope, Serve, r => runNodeServer(r, makeServer))))
      ),
      flatten
    ) as Fx<NodeHttpHandled<E>, A>

export type NodeHttpHandled<E> =
  Handle<Handle<E, Serve<any>, Async | Fail<NodeHttpError>>, Scoped<typeof ServeScope>>
  | Scoped<typeof ServeScope>

const runNodeServer = <E>(
  request: ServeRequest<E>,
  createServer: NodeHttpServerFactory
): Fx<Async | Fail<NodeHttpError>, void> => {
  const compiled = compileRoutes(request.routes)

  return startNodeServer(request.options, createServer, (incoming, outgoing) => {
    void runNodeRequest(compiled, request.context, incoming, outgoing)
  })
}

const startNodeServer = (
  options: ServeRequest['options'],
  createServer: NodeHttpServerFactory,
  listener: NodeRequestListener
): Fx<Async | Fail<NodeHttpError>, void> =>
  tryPromise(signal => new Promise<void>((resolve, reject) => {
    const server = createServer(listener)
    let listening = false
    let closed = false
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      if (closed) return
      closed = true
      cleanup()
      server.close(error => error ? reject(error) : resolve())
    }
    const cleanup = () => {
      server.off?.('error', onError)
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort)
    server.on('error', onError)
    server.listen(options.port, options.host, () => {
      listening = true
      if (signal.aborted) onAbort()
    })

    if (!listening && signal.aborted) onAbort()
  })).pipe(
    catchAll(failNodeHttp('Node HTTP server failed'))
  )

const runNodeRequest = async <E>(
  compiled: CompiledRoutes<E>,
  context: ServeRequest<E>['context'],
  incoming: IncomingMessage,
  outgoing: NodeServerResponse
): Promise<void> => {
  const program = fx(function* () {
    const request = toServerRequest(incoming)
    const response = yield* dispatch(compiled, request)
    yield* writeNodeResponse(outgoing, response)
  })

  try {
    await withContext(context, program as Fx<unknown, void>).pipe(
      catchAll(() => writeInternalServerError(outgoing)),
      f => runPromise(f as Fx<Async | Scoped<string>, void>)
    )
  } catch {
    outgoing.destroy()
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

const toUint8Array = (chunk: unknown): Uint8Array =>
  chunk instanceof Uint8Array
    ? chunk
    : new Uint8Array(Buffer.from(String(chunk)))
