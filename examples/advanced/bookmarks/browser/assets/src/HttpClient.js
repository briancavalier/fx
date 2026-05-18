import { tryPromise } from './Async.js';
import { at } from './Breadcrumb.js';
import { Effect, withOrigin } from './Effect.js';
import { catchAll, fail, failFrom } from './Fail.js';
import { flatMap, map, ok } from './Fx.js';
import { handle } from './Handler.js';
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
export class HttpRequest extends Effect('fx/HttpClient/HttpRequest') {
}
/**
 * Construct an {@link HttpRequest} from a request description.
 * @example
 *   const response = request({
 *     method: 'POST',
 *     url: new URL('https://example.com/users'),
 *     body: { type: 'json', value: { name: 'Ada' } }
 *   })
 */
export const request = (r) => withOrigin(new HttpRequest(r), at('fx/HttpClient/request', request));
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
export const expectStatus = (...expected) => (response) => expected.includes(response.status) ? ok(response) : fail(new UnexpectedStatus(expected.join(' | '), response.status));
/**
 * Require a 2xx response, narrowing the response status type.
 * @example
 *   const successful = request({
 *     url: new URL('https://example.com/users/1')
 *   }).pipe(
 *     flatMap(expectSuccess)
 *   )
 */
export const expectSuccess = (response) => response.status >= 200 && response.status < 300
    ? ok(response)
    : fail(new UnexpectedStatus('2xx', response.status));
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
export const decodeBytes = (response) => bytes(response).pipe(map(body => ({ ...response, body })));
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
export const bytes = (response) => {
    if (!response.body)
        return ok(new Uint8Array());
    const body = response.body;
    return tryPromise(() => readStream(body)).pipe(catchAll(cause => fail(new DecodeError('Failed to decode response body', { cause }))));
};
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
export const decodeText = (response) => text(response).pipe(map(body => ({ ...response, body })));
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
export const text = (response) => bytes(response).pipe(flatMap(data => {
    try {
        return ok(new TextDecoder("utf-8", { fatal: true }).decode(data));
    }
    catch (cause) {
        return fail(new DecodeError("Failed to decode response body as UTF-8", { cause }));
    }
}));
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
export const decodeJson = (response) => json(response).pipe(map(body => ({ ...response, body })));
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
export const json = (response) => text(response).pipe(flatMap(value => {
    try {
        return ok(JSON.parse(value));
    }
    catch (cause) {
        return fail(new DecodeError("Failed to decode response body as JSON", { cause }));
    }
}));
/**
 * Failure raised when a response has an unexpected status code.
 */
export class UnexpectedStatus extends Error {
    expected;
    actual;
    constructor(expected, actual, options) {
        super(`actual: ${actual}, expected: ${expected}`, options);
        this.expected = expected;
        this.actual = actual;
    }
}
/**
 * Failure raised when a response body cannot be decoded.
 */
export class DecodeError extends Error {
}
/**
 * Failure raised when an HTTP request cannot be transported.
 */
export class TransportError extends Error {
    request;
    constructor(request, options) {
        super(`HTTP request failed: ${request.method ?? 'GET'} ${String(request.url)}`, options);
        this.request = request;
    }
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
export const w3cFetch = ({ fetch = globalThis.fetch, init = (_, i) => i } = {}) => (f) => f.pipe(handle(HttpRequest, httpRequest => {
    const r = httpRequest.arg;
    return tryPromise(signal => fetch(r.url, init(r, toFetchRequest(r, signal))).then(toResponse)).pipe(catchAll(cause => failFrom(httpRequest, new TransportError(r, { cause }))));
}));
const readStream = async (stream) => {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            chunks.push(value);
            total += value.byteLength;
        }
    }
    finally {
        reader.releaseLock();
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
};
const toFetchRequest = (r, signal) => ({ method: r.method, ...toFetchBody(r), signal });
const toFetchBody = (r) => {
    const h = r.headers
        ? new globalThis.Headers(r.headers.map(([name, value]) => [name, value]))
        : new globalThis.Headers();
    if (!r.body)
        return { headers: h };
    switch (r.body.type) {
        case 'text':
            return { body: r.body.value, headers: h };
        case 'json':
            if (!h.has('content-type')) {
                h.set('content-type', 'application/json');
            }
            return { body: JSON.stringify(r.body.value), headers: h };
        case 'bytes':
            if (r.body.contentType !== undefined && !h.has('content-type')) {
                h.set('content-type', r.body.contentType);
            }
            return { body: r.body.value, headers: h };
        case 'stream':
            if (r.body.contentType !== undefined && !h.has('content-type')) {
                h.set('content-type', r.body.contentType);
            }
            return { body: r.body.value, headers: h };
    }
};
const toResponse = (r) => ({
    status: r.status,
    statusText: r.statusText,
    headers: [...r.headers.entries()],
    body: r.body === null ? emptyStream() : r.body
});
const emptyStream = () => new ReadableStream({
    start(c) {
        c.close();
    }
});
