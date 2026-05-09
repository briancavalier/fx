import * as assert from 'node:assert/strict'
import { createServer, request as nodeRequest, type IncomingHttpHeaders } from 'node:http'
import { describe, it } from 'node:test'
import { Async } from './Async.js'
import { Effect } from './Effect.js'
import { Fail, assert as assertNoFail, fail } from './Fail.js'
import { ok, fx, run, runPromise, runTask, type Fx } from './Fx.js'
import { handle } from './Handler.js'
import {
  compileRoutes,
  dispatch,
  emptyRoutes,
  handleRoutes,
  mount,
  route,
  routes,
  serve,
  type EffectsOfRoutes,
  type ResponseBody,
  type Routes,
  type ServerEvent,
  type ServerRequest,
  type ServerResponse
} from './HttpServer.js'
import { NodeHttpError, nodeHttp, type NodeHttpServerFactory } from './HttpServerNode.js'
import { Scoped } from './Scoped.js'
import { emit, Stream } from './Stream.js'
import { dispose } from './Task.js'

describe('HttpServer', () => {
  describe('route AST', () => {
    it('merges route effect types', () => {
      class E1 extends Effect('test/HttpServer/E1')<void, string> { }
      class E2 extends Effect('test/HttpServer/E2')<void, number> { }

      const r1 = route('GET', '/one', () => new E1().pipe(responseText))
      const r2 = route('GET', '/two', () => new E2().pipe(responseText))
      const rs = routes(r1, r2)

      type Actual = EffectsOfRoutes<typeof rs>
      const _: Routes<E1 | E2> = rs
      void (_ satisfies Routes<Actual>)
    })

    it('mount composes prefixes without mutating child routes', async () => {
      const child = route('GET', '/:id', req => ok(text(req.params.id)))
      const app = mount('/users', child)

      const childResponse = await dispatch(compileRoutes(child), request('/users/1')).pipe(runPromise)
      const mountedResponse = await dispatch(compileRoutes(app), request('/users/1')).pipe(runPromise)

      assert.equal(childResponse.status, 404)
      assert.equal(mountedResponse.status, 200)
      assert.equal(await readBody(mountedResponse.body), '1')
    })

    it('transforms route handler effects', async () => {
      class CurrentValue extends Effect('test/HttpServer/TransformCurrentValue')<void, string> { }

      const app = route('GET', '/current', () => fx(function* () {
        return text(yield* new CurrentValue())
      }))

      const handled = handleRoutes<CurrentValue, never>(handle(CurrentValue, () => ok('handled')))(app)
      const response = dispatch(compileRoutes(handled), request('/current')).pipe(run)

      assert.equal(response.status, 200)
      assert.equal(await readBody(response.body), 'handled')
    })

    it('keeps route effects visible until the server program handles them', () => {
      class CurrentValue extends Effect('test/HttpServer/ServeCurrentValue')<void, string> { }

      const app = route('GET', '/current', () => fx(function* () {
        return text(yield* new CurrentValue())
      }))

      serve(app, { port: 3000 })

      const unhandled = serve(app, { port: 3000 }).pipe(
        nodeHttp(),
        assertNoFail
      )
      // @ts-expect-error route effects remain visible until a handler eliminates them
      const _: Fx<Async | Scoped<string>, void> = unhandled
      void _

      const handled = unhandled.pipe(handle(CurrentValue, () => ok('handled')))
      const runnable: Fx<Async | Scoped<string>, void> = handled
      void runnable
    })
  })

  describe('reference dispatcher', () => {
    it('matches exact routes', async () => {
      const app = route('GET', '/health', () => ok(text('ok')))

      const response = await dispatch(compileRoutes(app), request('/health')).pipe(runPromise)

      assert.equal(response.status, 200)
      assert.equal(await readBody(response.body), 'ok')
    })

    it('matches params', async () => {
      const app = route('GET', '/users/:id', req => ok(text(req.params.id)))

      const response = await dispatch(compileRoutes(app), request('/users/alice')).pipe(runPromise)

      assert.equal(response.status, 200)
      assert.equal(await readBody(response.body), 'alice')
    })

    it('matches mounted params', async () => {
      const app = mount('/api', route('GET', '/users/:id', req => ok(text(req.params.id))))

      const response = await dispatch(compileRoutes(app), request('/api/users/bob')).pipe(runPromise)

      assert.equal(response.status, 200)
      assert.equal(await readBody(response.body), 'bob')
    })

    it('matches trailing wildcards', async () => {
      const app = route('GET', '/files/*', req => ok(text(req.params['*'])))

      const response = await dispatch(compileRoutes(app), request('/files/a/b/c')).pipe(runPromise)

      assert.equal(response.status, 200)
      assert.equal(await readBody(response.body), 'a/b/c')
    })

    it('returns 404 when no route matches', async () => {
      const response = await dispatch(compileRoutes(emptyRoutes), request('/missing')).pipe(runPromise)

      assert.equal(response.status, 404)
      assert.equal(await readBody(response.body), 'Not Found')
    })

    it('uses declaration order for ambiguous matches', async () => {
      const app = routes(
        route<never>('GET', '/users/:id', req => ok(text(`param:${req.params.id}`))),
        route<never>('GET', '/users/me', () => ok(text('exact')))
      ) as Routes<never>

      const response = await dispatch(compileRoutes(app), request('/users/me')).pipe(runPromise)

      assert.equal(response.status, 200)
      assert.equal(await readBody(response.body), 'param:me')
    })
  })

  describe('nodeHttp', () => {
    it('starts a server and serves a text response', async () => {
      const app = route('GET', '/health', () => ok(text('ok')))

      await withServer(createServer => serve(app, { port: 0, host: '127.0.0.1' }).pipe(
        nodeHttp({ createServer })
      ), async port => {
        const response = await httpGet(port, '/health')
        assert.equal(response.status, 200)
        assert.equal(response.body, 'ok')
      })
    })

    it('emits listening with the actual bound address', async () => {
      const app = route('GET', '/health', () => ok(text('ok')))
      const events: ServerEvent[] = []

      await withServer(createServer => serve(app, {
        port: 0,
        host: '127.0.0.1',
          observe: event => ok(void events.push(event))
      }).pipe(
        nodeHttp({ createServer })
      ), async port => {
        const event = await waitForEvent(events, isListening)

        assert.equal(typeof event.address, 'object')
        if (event.address === null) {
          throw new Error('Expected Node listen address')
        }
        assert.equal(event.address.host, '127.0.0.1')
        assert.equal(event.address.port, port)
      })
    })

    it('emits completed request summaries', async () => {
      const app = route('GET', '/health', () => ok(text('ok')))
      const events: ServerEvent[] = []

      await withServer(createServer => serve(app, {
        port: 0,
        host: '127.0.0.1',
          observe: event => ok(void events.push(event))
      }).pipe(
        nodeHttp({ createServer })
      ), async port => {
        const response = await httpGet(port, '/health')
        const event = await waitForEvent(events, isRequest)

        assert.equal(response.status, 200)
        assert.deepEqual(
          {
            type: event.type,
            method: event.method,
            path: event.path,
            status: event.status
          },
          {
            type: 'request',
            method: 'GET',
            path: '/health',
            status: 200
          }
        )
        assert.equal(event.durationMs >= 0, true)
      })
    })

    it('passes request details to route handlers', async () => {
      const app = route('GET', '/users/:id', req => ok(text(JSON.stringify({
        method: req.method,
        path: req.path,
        query: req.query.get('q'),
        params: req.params,
        host: req.headers.find(([name]) => name === 'host')?.[1]
      }))))

      await withServer(createServer => serve(app, { port: 0, host: '127.0.0.1' }).pipe(
        nodeHttp({ createServer })
      ), async port => {
        const response = await httpGet(port, '/users/ada?q=one')
        assert.equal(response.status, 200)
        assert.deepEqual(JSON.parse(response.body), {
          method: 'GET',
          path: '/users/ada',
          query: 'one',
          params: { id: 'ada' },
          host: `127.0.0.1:${port}`
        })
      })
    })

    it('writes bytes and stream bodies', async () => {
      const app = routes(
        route<never>('GET', '/bytes', () => ok({
          status: 200,
          body: { type: 'bytes', value: new TextEncoder().encode('bytes') }
        })),
        route<never>('GET', '/stream', () => ok({
          status: 200,
          body: {
            type: 'stream',
            value: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('stream'))
                controller.close()
              }
            })
          }
        }))
      ) as Routes<never>

      await withServer(createServer => serve(app, { port: 0, host: '127.0.0.1' }).pipe(
        nodeHttp({ createServer })
      ), async port => {
        assert.equal((await httpGet(port, '/bytes')).body, 'bytes')
        assert.equal((await httpGet(port, '/stream')).body, 'stream')
      })
    })

    it('writes JSON bodies with a default content-type', async () => {
      const app = route('GET', '/json', () => ok({
        status: 200,
        body: { type: 'json', value: { ok: true } }
      }))

      await withServer(createServer => serve(app, { port: 0, host: '127.0.0.1' }).pipe(
        nodeHttp({ createServer })
      ), async port => {
        const response = await httpGet(port, '/json')
        assert.equal(response.status, 200)
        assert.equal(response.headers['content-type'], 'application/json')
        assert.deepEqual(JSON.parse(response.body), { ok: true })
      })
    })

    it('preserves explicit JSON content-type headers', async () => {
      const app = route('GET', '/json', () => ok({
        status: 200,
        headers: [['content-type', 'application/vnd.api+json']],
        body: { type: 'json', value: { ok: true } }
      }))

      await withServer(createServer => serve(app, { port: 0, host: '127.0.0.1' }).pipe(
        nodeHttp({ createServer })
      ), async port => {
        const response = await httpGet(port, '/json')
        assert.equal(response.headers['content-type'], 'application/vnd.api+json')
      })
    })

    it('runs route handlers with handlers outside nodeHttp', async () => {
      class CurrentValue extends Effect('test/HttpServer/CurrentValue')<void, string> { }

      const app = route('GET', '/current', () => fx(function* () {
        return text(yield* new CurrentValue())
      }))

      await withServer(
        createServer => serve(app, { port: 0, host: '127.0.0.1' }).pipe(
          nodeHttp({ createServer }),
          handle(CurrentValue, () => ok('captured'))
        ),
        async port => {
          const response = await httpGet(port, '/current')
          assert.equal(response.body, 'captured')
        }
      )
    })

    it('runs route handlers with handlers before nodeHttp', async () => {
      class CurrentValue extends Effect('test/HttpServer/InnerCurrentValue')<void, string> { }

      const app = route('GET', '/current', () => fx(function* () {
        return text(yield* new CurrentValue())
      }))

      await withServer(
        createServer => serve(app, { port: 0, host: '127.0.0.1' }).pipe(
          handle(CurrentValue, () => ok('captured')),
          nodeHttp({ createServer })
        ),
        async port => {
          const response = await httpGet(port, '/current')
          assert.equal(response.body, 'captured')
        }
      )
    })

    it('converts route failures to 500 responses', async () => {
      const app = route('GET', '/fail', () => fail(new Error('failed')))

      await withServer(createServer => serve(app, { port: 0, host: '127.0.0.1' }).pipe(
        nodeHttp({ createServer })
      ), async port => {
        const response = await httpGet(port, '/fail')
        assert.equal(response.status, 500)
        assert.equal(response.body, 'Internal Server Error')
      })
    })

    it('emits 500 request summaries for route failures', async () => {
      const app = route('GET', '/fail', () => fail(new Error('failed')))
      const events: ServerEvent[] = []

      await withServer(createServer => serve(app, {
        port: 0,
        host: '127.0.0.1',
          observe: event => ok(void events.push(event))
      }).pipe(
        nodeHttp({ createServer })
      ), async port => {
        const response = await httpGet(port, '/fail')
        const event = await waitForEvent(events, isRequest)

        assert.equal(response.status, 500)
        assert.equal(event.status, 500)
      })
    })

    it('keeps observer stream effects visible until handled', () => {
      const app = route('GET', '/health', () => ok(text('ok')))

      const observed = serve(app, {
        port: 3000,
        observe: event => emit(event)
      }).pipe(
        nodeHttp(),
        assertNoFail
      )

      const _: Fx<Async | Scoped<string> | Stream<ServerEvent>, void> = observed
      void _
    })

    it('fails fast and closes the server when observation fails', async () => {
      const app = route('GET', '/health', () => ok(text('ok')))
      const failure = new Error('observation failed')
      let closeCalled = false

      const task = serve(app, {
        port: 0,
        host: '127.0.0.1',
        observe: event => event.type === 'listening' ? fail(failure) : ok(undefined)
      }).pipe(
        nodeHttp({
          createServer: listener => {
            const server = createServer(listener)
            return {
              listen: (port, host, callback) => server.listen(port, host, callback),
              close: callback => {
                closeCalled = true
                return server.close(callback)
              },
              on: (event, listener) => server.on(event, listener),
              off: (event, listener) => server.off(event, listener),
              address: () => server.address()
            }
          }
        }),
        assertNoFail,
        runTask
      )

      try {
        await assert.rejects(task.promise, error => error instanceof Error && error.cause === failure)
        assert.equal(closeCalled, true)
      } finally {
        dispose(task)
      }
    })
  })
})

const responseText = <A>(f: Fx<any, A>) =>
  f.pipe(x => fx(function* () {
    return text(String(yield* x))
  }))

const request = (path: string, method = 'GET'): ServerRequest => {
  const url = new URL(path, 'http://example.com')
  return {
    method: method as ServerRequest['method'],
    url,
    path: url.pathname,
    query: url.searchParams,
    headers: [],
    body: new ReadableStream({ start: c => c.close() }),
    params: {}
  }
}

const text = (value: string): ServerResponse<never> => ({
  status: 200,
  body: { type: 'text', value }
})

const readBody = async (body: ResponseBody<any> | undefined): Promise<string> => {
  if (!body) return ''

  switch (body.type) {
    case 'empty':
      return ''
    case 'text':
      return body.value
    case 'json':
      return JSON.stringify(body.value)
    case 'bytes':
      return new TextDecoder().decode(body.value)
    case 'stream': {
      const reader = body.value.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const result = await reader.read()
        if (result.done) return new TextDecoder().decode(concat(chunks))
        chunks.push(result.value)
      }
    }
  }
}

const withServer = async (
  program: (createServer: NodeHttpServerFactory) => Fx<Async | Scoped<string> | Fail<NodeHttpError>, void>,
  test: (port: number) => Promise<void>
) => {
  let port = 0
  const server = program(listener => {
    const server = createServer(listener)
    server.on('listening', () => {
      const address = server.address()
      if (address && typeof address !== 'string') port = address.port
    })
    return server
  }).pipe(assertNoFail)
  const task = runTask(server)

  while (port === 0) await new Promise(resolve => setTimeout(resolve, 1))

  try {
    await test(port)
  } finally {
    dispose(task)
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

const waitForEvent = async <E extends ServerEvent>(
  events: readonly ServerEvent[],
  match: (event: ServerEvent) => event is E
): Promise<E> => {
  for (let i = 0; i < 100; i++) {
    const event = events.find(match)
    if (event) return event
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('Timed out waiting for Node HTTP event')
}

const isListening = (
  event: ServerEvent
): event is Extract<ServerEvent, { readonly type: 'listening' }> =>
  event.type === 'listening'

const isRequest = (
  event: ServerEvent
): event is Extract<ServerEvent, { readonly type: 'request' }> =>
  event.type === 'request'

const httpGet = (
  port: number,
  path: string
): Promise<{ readonly status: number; readonly headers: Record<string, string>; readonly body: string }> =>
  new Promise((resolve, reject) => {
    const request = nodeRequest({ host: '127.0.0.1', port, path }, response => {
      const chunks: Uint8Array[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: toHeaderRecord(response.headers),
        body: new TextDecoder().decode(concat(chunks))
      }))
    })
    request.on('error', reject)
    request.end()
  })

const toHeaderRecord = (headers: IncomingHttpHeaders): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).flatMap(([name, value]) =>
    typeof value === 'string' ? [[name, value]] : []
  ))

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
