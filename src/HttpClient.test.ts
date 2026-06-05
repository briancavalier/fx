import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Fail, returnFail } from './Fail.js'
import { runPromise } from './Fx.js'
import { snapshotTrace } from './Trace.js'
import {
  DecodeError,
  TransportError,
  UnexpectedStatus,
  bytes,
  expectStatus,
  expectSuccess,
  json,
  request,
  text,
  w3cFetch,
  type Response
} from './HttpClient.js'

type CapturedFetchInit = {
  readonly method?: string
  readonly body?: unknown
  readonly signal?: unknown
  readonly headers?: ConstructorParameters<typeof globalThis.Headers>[0]
  readonly credentials?: NonNullable<globalThis.RequestInit['credentials']>
  readonly redirect?: NonNullable<globalThis.RequestInit['redirect']>
}

describe('HttpClient', () => {
  describe('expectStatus', () => {
    it('given matching status, returns response', async () => {
      const expected = response({ status: 204 })

      const actual = await expectStatus(200, 204)(expected).pipe(
        returnFail,
        runPromise
      )

      assert.equal(actual, expected)
    })
  })

  describe('expectSuccess', () => {
    it('given 2xx status, returns response', async () => {
      const expected = response({ status: 204 })

      const actual = await expectSuccess(expected).pipe(
        returnFail,
        runPromise
      )

      assert.equal(actual, expected)
    })

    it('given non-2xx status, produces UnexpectedStatus failure', async () => {
      const actual = await expectSuccess(response({ status: 300 })).pipe(
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(actual))
      assert.ok(actual.arg instanceof UnexpectedStatus)
      assert.equal(actual.arg.expected, '2xx')
      assert.equal(actual.arg.actual, 300)
    })
  })

  describe('bytes', () => {
    it('given no body, returns empty bytes', async () => {
      const actual = await bytes(response()).pipe(
        returnFail,
        runPromise
      )

      assert.deepEqual(actual, new Uint8Array())
    })

    it('given stream body, returns concatenated bytes', async () => {
      const actual = await bytes(response({
        body: stream([
          new Uint8Array([1, 2]),
          new Uint8Array([3]),
          new Uint8Array([4, 5])
        ])
      })).pipe(
        returnFail,
        runPromise
      )

      assert.deepEqual(actual, new Uint8Array([1, 2, 3, 4, 5]))
    })
  })

  describe('text', () => {
    it('given UTF-8 body, returns decoded text', async () => {
      const actual = await text(response({
        body: stream([new TextEncoder().encode('hello \u2603')])
      })).pipe(
        returnFail,
        runPromise
      )

      assert.equal(actual, 'hello \u2603')
    })

    it('given invalid UTF-8 body, produces DecodeError failure', async () => {
      const actual = await text(response({
        body: stream([new Uint8Array([0xff])])
      })).pipe(
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(actual))
      assert.ok(actual.arg instanceof DecodeError)
    })
  })

  describe('json', () => {
    it('given JSON body, returns decoded JSON value', async () => {
      const actual = await json(response({
        body: stream([new TextEncoder().encode('{"name":"Ada","count":2}')])
      })).pipe(
        returnFail,
        runPromise
      )

      assert.deepEqual(actual, { name: 'Ada', count: 2 })
    })

    it('given malformed JSON body, produces DecodeError failure', async () => {
      const actual = await json(response({
        body: stream([new TextEncoder().encode('{')])
      })).pipe(
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(actual))
      assert.ok(actual.arg instanceof DecodeError)
    })
  })

  describe('w3cFetch', () => {
    it('converts HttpRequest to fetch request and fetch response', async () => {
      const url = new URL('https://example.com/users')
      let actualInput: unknown
      let actualInit: CapturedFetchInit | undefined

      const fetch = ((input, init) => {
        actualInput = input
        actualInit = init

        return Promise.resolve(new globalThis.Response(new ReadableStream<Uint8Array>({
          start: controller => controller.close()
        }), {
          status: 201,
          statusText: 'Created',
          headers: [['x-response', 'yes']]
        }))
      }) as typeof globalThis.fetch

      const actual = await request({
        method: 'POST',
        url,
        headers: [['accept', 'application/json']],
        body: { type: 'json', value: { name: 'Ada' } }
      }).pipe(
        w3cFetch({ fetch }),
        returnFail,
        runPromise
      )

      assert.equal(actualInput, url)
      assert.equal(actualInit?.method, 'POST')
      assert.equal(actualInit?.body, JSON.stringify({ name: 'Ada' }))
      assert.ok(actualInit?.signal instanceof AbortSignal)

      const headers = new globalThis.Headers(actualInit?.headers)
      assert.equal(headers.get('accept'), 'application/json')
      assert.equal(headers.get('content-type'), 'application/json')

      assert.ok(!Fail.is(actual))
      assert.equal(actual.status, 201)
      assert.equal(actual.statusText, 'Created')
      assert.deepEqual(actual.headers, [['x-response', 'yes']])
      assert.ok(actual.body)
    })

    it('preserves explicit content-type', async () => {
      let actualInit: CapturedFetchInit | undefined

      const fetch = ((_input, init) => {
        actualInit = init
        return Promise.resolve(new globalThis.Response(null))
      }) as typeof globalThis.fetch

      await request({
        method: 'POST',
        url: new URL('https://example.com/users'),
        headers: [['content-type', 'application/vnd.api+json']],
        body: { type: 'json', value: { name: 'Ada' } }
      }).pipe(
        w3cFetch({ fetch }),
        returnFail,
        runPromise
      )

      const headers = new globalThis.Headers(actualInit?.headers)
      assert.equal(headers.get('content-type'), 'application/vnd.api+json')
    })

    it('allows fetch RequestInit customization', async () => {
      const expectedRequest = {
        method: 'POST' as const,
        url: new URL('https://example.com/users'),
        headers: [['accept', 'application/json']] as const,
        body: { type: 'json' as const, value: { name: 'Ada' } }
      }
      let actualHookRequest: unknown
      let actualHookInit: CapturedFetchInit | undefined
      let actualFetchInit: CapturedFetchInit | undefined

      const fetch = ((_input, init) => {
        actualFetchInit = init
        return Promise.resolve(new globalThis.Response(null))
      }) as typeof globalThis.fetch

      await request(expectedRequest).pipe(
        w3cFetch({
          fetch,
          init: (r, init) => {
            actualHookRequest = r
            actualHookInit = init

            return {
              ...init,
              credentials: 'include',
              redirect: 'manual'
            }
          }
        }),
        returnFail,
        runPromise
      )

      assert.equal(actualHookRequest, expectedRequest)
      assert.equal(actualHookInit?.method, 'POST')
      assert.equal(actualHookInit?.body, JSON.stringify({ name: 'Ada' }))
      assert.ok(actualHookInit?.signal instanceof AbortSignal)
      assert.equal(actualFetchInit?.credentials, 'include')
      assert.equal(actualFetchInit?.redirect, 'manual')
      assert.equal(actualFetchInit?.method, 'POST')
      assert.equal(actualFetchInit?.body, JSON.stringify({ name: 'Ada' }))
    })

    it('converts rejected fetch promises to TransportError failure', async () => {
      const cause = new Error('network failure')
      const expectedRequest = {
        method: 'GET' as const,
        url: new URL('https://example.com/users'),
      }

      const fetch = (() => Promise.reject(cause)) as typeof globalThis.fetch

      const actual = await request(expectedRequest).pipe(
        w3cFetch({ fetch }),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(actual))
      assert.ok(actual.arg instanceof TransportError)
      assert.equal(actual.arg.request, expectedRequest)
      assert.equal(actual.arg.cause, cause)
      assert.equal(actual.arg.message, 'HTTP request failed: GET https://example.com/users')
      assert.ok(actual.trace !== undefined)
      const trace = snapshotTrace(actual.trace)
      assert.equal(trace.frames[0]?.message, 'fx/HttpClient/request')
      assert.match(trace.frames[0]?.location?.file ?? '', /HttpClient\.test\.ts$/)
    })

    it('converts thrown init errors to TransportError failure', async () => {
      const cause = new Error('init failure')
      const expectedRequest = {
        method: 'GET' as const,
        url: new URL('https://example.com/users'),
      }
      const fetch = (() => Promise.resolve(new globalThis.Response(null))) as typeof globalThis.fetch

      const actual = await request(expectedRequest).pipe(
        w3cFetch({
          fetch,
          init: () => { throw cause }
        }),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(actual))
      assert.ok(actual.arg instanceof TransportError)
      assert.equal(actual.arg.request, expectedRequest)
      assert.equal(actual.arg.cause, cause)
    })

    it('uses GET in TransportError message when method is omitted', async () => {
      const cause = new Error('network failure')
      const expectedRequest = {
        url: new URL('https://example.com/users'),
      }

      const fetch = (() => Promise.reject(cause)) as typeof globalThis.fetch

      const actual = await request(expectedRequest).pipe(
        w3cFetch({ fetch }),
        returnFail,
        runPromise
      )

      assert.ok(Fail.is(actual))
      assert.ok(actual.arg instanceof TransportError)
      assert.equal(actual.arg.message, 'HTTP request failed: GET https://example.com/users')
    })
  })
})

const response = ({
  status = 200,
  statusText,
  headers = [],
  body = emptyStream()
}: Partial<Response<number, ReadableStream<Uint8Array>>> = {}): Response<number, ReadableStream<Uint8Array>> => ({
  status,
  statusText,
  headers,
  body
})

const stream = (chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start: controller => {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    }
  })

const emptyStream = () =>
  new ReadableStream({
    start(c) {
      c.close()
    }
  })
