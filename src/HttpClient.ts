import { Async, tryPromise } from './Async.js'
import { Effect } from './Effect.js'
import { Fail, catchAll, fail } from './Fail.js'
import { Fx, flatMap, map, ok } from './Fx.js'
import { handle } from './Handler.js'

export class HttpRequest extends Effect('fx/HttpClient/HttpRequest')<Request, Response<number, ResponseBody>> { }

export const request = (r: Request) => new HttpRequest(r)

export type Request = {
  readonly method?: Method,
  readonly url: URL,
  readonly body?: RequestBody,
  readonly headers?: Headers
}

export type Response<S, B, H = Headers> = {
  readonly status: S
  readonly statusText?: string
  readonly headers: H
  readonly body: B
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type Status = number
export type Headers = ReadonlyArray<readonly [string, string]>

export type ResponseBody = ReadableStream<Uint8Array>

export type RequestBody =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'json'; readonly value: unknown }
  | { readonly type: 'bytes'; readonly value: Uint8Array; readonly contentType?: string }
  | { readonly type: 'stream'; readonly value: ReadableStream<Uint8Array>; readonly contentType?: string }

export const expectStatus = <S extends readonly [number, ...readonly number[]]>
  (...expected: S) =>
  <B, H>(response: Response<number, B, H>): Fx<Fail<UnexpectedStatus>, Response<S[number], B, H>> =>
    expected.includes(response.status) ? ok(response) : fail(new UnexpectedStatus(expected.join(' | '), response.status))

export type SuccessStatus =
  | 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226

export const expectSuccess = <B, H>(
  response: Response<number, B, H>
): Fx<Fail<UnexpectedStatus>, Response<SuccessStatus, B, H>> =>
  response.status >= 200 && response.status < 300
    ? ok(response as Response<SuccessStatus, B, H>)
    : fail(new UnexpectedStatus('2xx', response.status))

export const decodeBytes = <S, H>(response: Response<S, ReadableStream<Uint8Array>, H>): Fx<Async | Fail<DecodeError>, Response<S, Uint8Array, H>> =>
  bytes(response).pipe(map(body => ({ ...response, body })))

export const bytes = <S, H>(response: Response<S, ReadableStream<Uint8Array>, H>): Fx<Async | Fail<DecodeError>, Uint8Array> => {
  if (!response.body) return ok(new Uint8Array())

  const body = response.body
  return tryPromise(() => readStream(body)).pipe(
    catchAll(cause => fail(new DecodeError('Failed to decode response body', { cause })))
  )
}

export const decodeText = <S, H>(response: Response<S, ReadableStream<Uint8Array>, H>): Fx<Async | Fail<DecodeError>, Response<S, string, H>> =>
  text(response).pipe(map(body => ({ ...response, body })))

export const text = <S, H>(response: Response<S, ReadableStream<Uint8Array>, H>): Fx<Async | Fail<DecodeError>, string> =>
  bytes(response).pipe(
    flatMap(data => {
      try {
        return ok(new TextDecoder("utf-8", { fatal: true }).decode(data))
      } catch (cause) {
        return fail(new DecodeError("Failed to decode response body as UTF-8", { cause }))
      }
    })
  )

export type JSONValue = null | number | string | boolean | readonly JSONValue[] | { readonly [K in string]: JSONValue }

export const decodeJson = <S, H>(response: Response<S, ReadableStream<Uint8Array>, H>): Fx<Async | Fail<DecodeError>, Response<S, JSONValue, H>> =>
  json(response).pipe(map(body => ({ ...response, body })))

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

export class UnexpectedStatus extends Error {
  constructor(readonly expected: string, readonly actual: number, options?: ErrorOptions) {
    super(`actual: ${actual}, expected: ${expected}`, options)
  }
}

export class DecodeError extends Error { }

export class TransportError extends Error {
  constructor(
    readonly request: Request,
    options?: ErrorOptions
  ) {
    super(`HTTP request failed: ${request.method ?? 'GET'} ${request.url}`, options)
  }
}

export type W3CFetchOptions = {
  readonly fetch?: typeof globalThis.fetch
  readonly init?: (r: Request, i: globalThis.RequestInit) => globalThis.RequestInit
}

export const w3cFetch = ({
  fetch = globalThis.fetch,
  init = (_, i) => i
}: W3CFetchOptions = {}) =>
  <const E, const A>(f: Fx<E, A>) =>
    f.pipe(
      handle(HttpRequest, r =>
        tryPromise(signal =>
          fetch(r.url, init(r, toFetchRequest(r, signal))).then(toResponse)
        ).pipe(
          catchAll(cause => fail(new TransportError(r, { cause })))
        )
      )
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
    ? new globalThis.Headers(r.headers.map(([name, value]) => [name, value]))
    : new globalThis.Headers()

  if (!r.body) return { headers: h }

  switch (r.body.type) {
    case 'text':
      return { body: r.body.value, headers: h }

    case 'json':
      if (!h.has('content-type')) {
        h.set('content-type', 'application/json')
      }

      return { body: JSON.stringify(r.body.value), headers: h }

    case 'bytes':
      if (r.body.contentType !== undefined && !h.has('content-type')) {
        h.set('content-type', r.body.contentType)
      }

      return { body: r.body.value, headers: h }

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
