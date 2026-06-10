import { Async, tryPromise } from './Async.js'
import { at } from './Breadcrumb.js'
import { Effect, withOrigin } from './Effect.js'
import { Fail, catchAll, fail, failFrom, runCatch } from './Fail.js'
import { Fx, flatMap, map, ok } from './Fx.js'
import { handle } from './Handler.js'

/**
 * An HTTP request effect. Programs yield {@link HttpRequest} values to describe
 * a request, and a handler such as {@link w3cFetch} chooses how to perform it.
 * @example
 *   const getUser = request({
 *     url: new URL('https://example.com/users/1')
 *   }).pipe(
 *     flatMap(expectSuccess),
 *     flatMap(decodeJson)
 *   )
 */
export class HttpRequest extends Effect('fx/HttpClient/HttpRequest')<Request, Response<number, ResponseBody>> { }

/**
 * Construct an {@link HttpRequest} from a request description.
 * @example
 *   const response = request({
 *     method: 'POST',
 *     url: new URL('https://example.com/users'),
 *     body: { type: 'json', value: { name: 'Ada' } }
 *   })
 */
export const request = (r: Request) =>
  withOrigin(new HttpRequest(r), at('fx/HttpClient/request', request))

/**
 * A transport-neutral HTTP request description.
 */
export type Request = {
  readonly method?: Method,
  readonly url: URL,
  readonly body?: RequestBody,
  readonly headers?: Headers
}

/**
 * A transport-neutral HTTP response with typed status, body, and headers.
 */
export type Response<S, B, H = Headers> = {
  readonly status: S
  readonly statusText?: string
  readonly headers: H
  readonly body: B
}

/**
 * HTTP methods supported by {@link Request}.
 */
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

/**
 * An HTTP response status code.
 */
export type Status = number

/**
 * HTTP headers as ordered name/value pairs.
 */
export type Headers = ReadonlyArray<readonly [string, string]>

/**
 * A streaming HTTP response body.
 */
export type ResponseBody = ReadableStream<Uint8Array>

/**
 * Supported request body representations.
 */
export type RequestBody =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'json'; readonly value: unknown }
  | { readonly type: 'bytes'; readonly value: Uint8Array; readonly contentType?: string }
  | { readonly type: 'stream'; readonly value: ReadableStream<Uint8Array>; readonly contentType?: string }

/**
 * Require one of the expected status codes, narrowing the response status type.
 * @example
 *   const created = request({
 *     method: 'POST',
 *     url: new URL('https://example.com/users')
 *   }).pipe(
 *     flatMap(expectStatus(201))
 *   )
 */
export const expectStatus = <S extends readonly [number, ...readonly number[]]>
  (...expected: S) =>
  <B, H>(response: Response<number, B, H>): Fx<Fail<UnexpectedStatus>, Response<S[number], B, H>> =>
    expected.includes(response.status) ? ok(response) : fail(new UnexpectedStatus(expected.join(' | '), response.status))

/**
 * HTTP status codes in the 2xx success range.
 */
export type SuccessStatus =
  | 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226

/**
 * Require a 2xx response, narrowing the response status type.
 * @example
 *   const successful = request({
 *     url: new URL('https://example.com/users/1')
 *   }).pipe(
 *     flatMap(expectSuccess)
 *   )
 */
export const expectSuccess = <B, H>(
  response: Response<number, B, H>
): Fx<Fail<UnexpectedStatus>, Response<SuccessStatus, B, H>> =>
  response.status >= 200 && response.status < 300
    ? ok(response as Response<SuccessStatus, B, H>)
    : fail(new UnexpectedStatus('2xx', response.status))

/**
 * Decode a streaming response body as bytes, preserving status and headers.
 * @example
 *   const responseWithBytes = request({
 *     url: new URL('https://example.com/file.bin')
 *   }).pipe(
 *     flatMap(expectSuccess),
 *     flatMap(decodeBytes)
 *   )
 */
export const decodeBytes = <S, H>(response: Response<S, ReadableStream<Uint8Array>, H>): Fx<Async | Fail<DecodeError>, Response<S, Uint8Array, H>> =>
  bytes(response).pipe(map(body => ({ ...response, body })))

/**
 * Decode a streaming response body as bytes.
 * @example
 *   const body = request({
 *     url: new URL('https://example.com/file.bin')
 *   }).pipe(
 *     flatMap(expectSuccess),
 *     flatMap(bytes)
 *   )
 */
export const bytes = <S, H>(response: Response<S, ResponseBody, H>): Fx<Async | Fail<DecodeError>, Uint8Array> => {
  if (!response.body) return ok(new Uint8Array())

  const body = response.body
  return tryPromise(() => readStream(body)).pipe(
    catchAll(cause => fail(new DecodeError('Failed to decode response body', { cause }))),
    runCatch
  )
}

/**
 * Decode a streaming response body as UTF-8 text, preserving status and headers.
 * @example
 *   const responseWithText = request({
 *     url: new URL('https://example.com/message.txt')
 *   }).pipe(
 *     flatMap(expectSuccess),
 *     flatMap(decodeText)
 *   )
 */
export const decodeText = <S, H>(response: Response<S, ResponseBody, H>): Fx<Async | Fail<DecodeError>, Response<S, string, H>> =>
  text(response).pipe(map(body => ({ ...response, body })))

/**
 * Decode a streaming response body as UTF-8 text.
 * @example
 *   const body = request({
 *     url: new URL('https://example.com/message.txt')
 *   }).pipe(
 *     flatMap(expectSuccess),
 *     flatMap(text)
 *   )
 */
export const text = <S, H>(response: Response<S, ResponseBody, H>): Fx<Async | Fail<DecodeError>, string> =>
  bytes(response).pipe(
    flatMap(data => {
      try {
        return ok(new TextDecoder("utf-8", { fatal: true }).decode(data))
      } catch (cause) {
        return fail(new DecodeError("Failed to decode response body as UTF-8", { cause }))
      }
    })
  )

/**
 * JSON values produced by {@link json} and {@link decodeJson}.
 */
export type JSONValue = null | number | string | boolean | readonly JSONValue[] | { readonly [K in string]: JSONValue }

/**
 * Decode a streaming response body as JSON, preserving status and headers.
 * @example
 *   const responseWithJson = request({
 *     url: new URL('https://example.com/users/1')
 *   }).pipe(
 *     flatMap(expectSuccess),
 *     flatMap(decodeJson)
 *   )
 */
export const decodeJson = <S, H>(response: Response<S, ReadableStream<Uint8Array>, H>): Fx<Async | Fail<DecodeError>, Response<S, JSONValue, H>> =>
  json(response).pipe(map(body => ({ ...response, body })))

/**
 * Decode a streaming response body as JSON.
 * @example
 *   const body = request({
 *     url: new URL('https://example.com/users/1')
 *   }).pipe(
 *     flatMap(expectSuccess),
 *     flatMap(json)
 *   )
 */
export const json = <S, H>(response: Response<S, ReadableStream<Uint8Array>, H>): Fx<Async | Fail<DecodeError>, JSONValue> =>
  text(response).pipe(
    flatMap(value => {
      try {
        return ok(JSON.parse(value))
      } catch (cause) {
        return fail(new DecodeError("Failed to decode response body as JSON", { cause }))
      }
    })
  )

/**
 * Failure raised when a response has an unexpected status code.
 */
export class UnexpectedStatus extends Error {
  constructor(readonly expected: string, readonly actual: number, options?: ErrorOptions) {
    super(`actual: ${actual}, expected: ${expected}`, options)
  }
}

/**
 * Failure raised when a response body cannot be decoded.
 */
export class DecodeError extends Error { }

/**
 * Failure raised when an HTTP request cannot be transported.
 */
export class TransportError extends Error {
  constructor(
    readonly request: Request,
    options?: ErrorOptions
  ) {
    super(`HTTP request failed: ${request.method ?? 'GET'} ${String(request.url)}`, options)
  }
}

/**
 * Options for the {@link w3cFetch} handler.
 */
export type W3CFetchOptions = {
  readonly fetch?: typeof globalThis.fetch
  readonly init?: (r: Request, i: globalThis.RequestInit) => globalThis.RequestInit
}

/**
 * Handle {@link HttpRequest} effects using W3C `fetch`. Rejected fetch promises,
 * thrown `init` errors, and other transport failures are propagated as
 * {@link TransportError} failures.
 * @example
 *   const result = program.pipe(
 *     w3cFetch({
 *       init: (_, init) => ({ ...init, credentials: 'include' })
 *     }),
 *     returnFail,
 *     runPromise
 *   )
 */
export const w3cFetch = ({
  fetch = globalThis.fetch,
  init = (_, i) => i
}: W3CFetchOptions = {}) =>
  <const E, const A>(f: Fx<E, A>) =>
    f.pipe(
      handle(HttpRequest, httpRequest => {
        const r = httpRequest.arg
        return tryPromise(signal =>
          fetch(r.url, init(r, toFetchRequest(r, signal))).then(toResponse)
        ).pipe(
          catchAll(cause => failFrom(httpRequest, new TransportError(r, { cause }))),
          runCatch
        )
      })
    )


const readStream = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result
}

const toFetchRequest = (r: Request, signal: AbortSignal): globalThis.RequestInit =>
  ({ method: r.method, ...toFetchBody(r), signal })

const toFetchBody = (r: Request): { readonly body?: NonNullable<globalThis.RequestInit['body']>; readonly headers?: globalThis.Headers } => {
  const h = r.headers
    ? new globalThis.Headers(r.headers.map(([name, value]) => [name, value] as [string, string]))
    : new globalThis.Headers()

  if (!r.body) return { headers: h }

  switch (r.body.type) {
    case 'text':
      return { body: r.body.value as NonNullable<globalThis.RequestInit['body']>, headers: h }

    case 'json':
      if (!h.has('content-type')) {
        h.set('content-type', 'application/json')
      }

      return { body: JSON.stringify(r.body.value), headers: h }

    case 'bytes':
      if (r.body.contentType !== undefined && !h.has('content-type')) {
        h.set('content-type', r.body.contentType)
      }

      return { body: r.body.value as NonNullable<globalThis.RequestInit['body']>, headers: h }

    case 'stream':
      if (r.body.contentType !== undefined && !h.has('content-type')) {
        h.set('content-type', r.body.contentType)
      }

      return { body: r.body.value, headers: h }
  }
}

const toResponse = (r: globalThis.Response): Response<number, ResponseBody, Headers> => ({
  status: r.status,
  statusText: r.statusText,
  headers: [...r.headers.entries()],
  body: r.body === null ? emptyStream() : r.body
})

const emptyStream = () =>
  new ReadableStream({
    start(c) {
      c.close()
    }
  })
