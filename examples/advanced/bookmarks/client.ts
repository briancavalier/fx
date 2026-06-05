import { type Async, catchAll, catchOnly, fail, type Fail, flatMap, type Fx, runCatch } from '@briancavalier/fx'

import { decodeOrFail, encodeOrFail } from '@briancavalier/fx/codec'
import type { Decode, Encode } from '@briancavalier/fx/codec'
import { expectSuccess, request, text, type Headers, type HttpRequest, type RequestBody } from '@briancavalier/fx/http-client'

import { AddBookmarkInputJson, BookmarkJson, BookmarksJson, InvalidBookmarkJson, withBookmarkCodecs } from './codec.js'
import type { AddBookmarkInput, Bookmark, BookmarkQuery } from './domain.js'

export type BookmarkClientError =
  | { readonly tag: 'BookmarkRequestFailed'; readonly cause: unknown }
  | { readonly tag: 'InvalidBookmarkResponse'; readonly value: unknown }

type BookmarkClientCodecEffects =
  | Encode<typeof AddBookmarkInputJson>
  | Decode<typeof BookmarkJson>
  | Decode<typeof BookmarksJson>
  | Fail<InvalidBookmarkJson>

export type BookmarkClientEffects =
  | HttpRequest
  | Async
  | Fail<BookmarkClientError>

type BookmarkClientRawEffects =
  | BookmarkClientEffects
  | BookmarkClientCodecEffects

export const createBookmark = (
  baseUrl: URL,
  input: AddBookmarkInput
): Fx<BookmarkClientEffects, Bookmark> =>
  createBookmarkRaw(baseUrl, input).pipe(withClientCodecs)

const createBookmarkRaw = (
  baseUrl: URL,
  input: AddBookmarkInput
): Fx<BookmarkClientRawEffects, Bookmark> =>
  encodeOrFail(AddBookmarkInputJson, input).pipe(
    flatMap(body => requestText(baseUrl, 'bookmarks', {
      method: 'POST',
      body: { type: 'text', value: body },
      headers: jsonHeaders
    })),
    flatMap(decodeBookmark)
  )

export const listBookmarks = (
  baseUrl: URL,
  query: BookmarkQuery = {}
): Fx<BookmarkClientEffects, readonly Bookmark[]> =>
  listBookmarksRaw(baseUrl, query).pipe(withClientCodecs)

const listBookmarksRaw = (
  baseUrl: URL,
  query: BookmarkQuery = {}
): Fx<BookmarkClientRawEffects, readonly Bookmark[]> =>
  requestText(baseUrl, 'bookmarks', {
    query: bookmarkQueryParams(query)
  }).pipe(
    flatMap(decodeBookmarks)
  )

export const markBookmarkRead = (
  baseUrl: URL,
  id: string
): Fx<BookmarkClientEffects, Bookmark> =>
  markBookmarkReadRaw(baseUrl, id).pipe(withClientCodecs)

const markBookmarkReadRaw = (
  baseUrl: URL,
  id: string
): Fx<BookmarkClientRawEffects, Bookmark> =>
  requestText(baseUrl, `bookmarks/${encodeURIComponent(id)}/read`, {
    method: 'PATCH'
  }).pipe(
    flatMap(decodeBookmark)
  )

export const archiveBookmark = (
  baseUrl: URL,
  id: string
): Fx<BookmarkClientEffects, Bookmark> =>
  archiveBookmarkRaw(baseUrl, id).pipe(withClientCodecs)

const archiveBookmarkRaw = (
  baseUrl: URL,
  id: string
): Fx<BookmarkClientRawEffects, Bookmark> =>
  requestText(baseUrl, `bookmarks/${encodeURIComponent(id)}/archive`, {
    method: 'PATCH'
  }).pipe(
    flatMap(decodeBookmark)
  )

export const refreshBookmarkMetadata = (
  baseUrl: URL,
  id: string
): Fx<BookmarkClientEffects, Bookmark> =>
  refreshBookmarkMetadataRaw(baseUrl, id).pipe(withClientCodecs)

const refreshBookmarkMetadataRaw = (
  baseUrl: URL,
  id: string
): Fx<BookmarkClientRawEffects, Bookmark> =>
  requestText(baseUrl, `bookmarks/${encodeURIComponent(id)}/metadata/refresh`, {
    method: 'POST'
  }).pipe(
    flatMap(decodeBookmark)
  )

type RequestOptions = {
  readonly method?: 'GET' | 'POST' | 'PATCH'
  readonly body?: RequestBody
  readonly headers?: Headers
  readonly query?: URLSearchParams
}

const requestText = (
  baseUrl: URL,
  path: string,
  options: RequestOptions = {}
): Fx<HttpRequest | Async | Fail<BookmarkClientError>, string> =>
  request({
    method: options.method,
    url: apiUrl(baseUrl, path, options.query),
    body: options.body,
    headers: options.headers
  }).pipe(
    flatMap(expectSuccess),
    flatMap(text),
    catchAll(cause => fail({ tag: 'BookmarkRequestFailed', cause })), runCatch
  )

const apiUrl = (baseUrl: URL, path: string, query?: URLSearchParams): URL => {
  const url = new URL(path, baseUrl.href.endsWith('/') ? baseUrl : new URL(`${baseUrl.href}/`))
  if (query !== undefined) {
    for (const [name, value] of query) url.searchParams.append(name, value)
  }
  return url
}

const bookmarkQueryParams = (query: BookmarkQuery): URLSearchParams => {
  const params = new URLSearchParams()
  if (query.status !== undefined) params.set('status', query.status)
  if (query.tag !== undefined) params.set('tag', query.tag)
  if (query.text !== undefined) params.set('text', query.text)
  return params
}

const decodeBookmarks = (value: string): Fx<Decode<typeof BookmarksJson> | Fail<InvalidBookmarkJson>, readonly Bookmark[]> =>
  decodeOrFail(BookmarksJson, value)

const decodeBookmark = (value: string): Fx<Decode<typeof BookmarkJson> | Fail<InvalidBookmarkJson>, Bookmark> =>
  decodeOrFail(BookmarkJson, value)

const jsonHeaders: Headers = [['content-type', 'application/json']]

const withClientCodecs = <E, A>(program: Fx<E, A>): Fx<Exclude<E, BookmarkClientCodecEffects> | Fail<BookmarkClientError>, A> =>
  program.pipe(
    withBookmarkCodecs,
    catchOnly(InvalidBookmarkJson, error => fail({ tag: 'InvalidBookmarkResponse', value: error } as const))
  ) as Fx<Exclude<E, BookmarkClientCodecEffects> | Fail<BookmarkClientError>, A>
