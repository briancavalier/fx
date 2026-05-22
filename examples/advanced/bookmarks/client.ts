import { type Async, catchAll, fail, type Fail, flatMap, type Fx } from '@briancavalier/fx'

import { decode } from '@briancavalier/fx/codec'
import { expectSuccess, json, request, type HttpRequest, type JSONValue } from '@briancavalier/fx/http-client'

import { BookmarkJson, BookmarksJson, type BookmarkWire, withBookmarkCodecs } from './codec.js'
import type { AddBookmarkInput, Bookmark, BookmarkQuery } from './domain.js'

export type BookmarkClientError =
  | { readonly tag: 'BookmarkRequestFailed'; readonly cause: unknown }
  | { readonly tag: 'InvalidBookmarkResponse'; readonly value: unknown }

export type BookmarkClientEffects =
  | HttpRequest
  | Async
  | Fail<BookmarkClientError>

export const createBookmark = (
  baseUrl: URL,
  input: AddBookmarkInput
): Fx<BookmarkClientEffects, Bookmark> =>
  requestJson(baseUrl, 'bookmarks', {
    method: 'POST',
    body: { type: 'json', value: input }
  }).pipe(
    flatMap(decodeBookmark)
  )

export const listBookmarks = (
  baseUrl: URL,
  query: BookmarkQuery = {}
): Fx<BookmarkClientEffects, readonly Bookmark[]> =>
  requestJson(baseUrl, 'bookmarks', {
    query: bookmarkQueryParams(query)
  }).pipe(
    flatMap(decodeBookmarks)
  )

export const markBookmarkRead = (
  baseUrl: URL,
  id: string
): Fx<BookmarkClientEffects, Bookmark> =>
  requestJson(baseUrl, `bookmarks/${encodeURIComponent(id)}/read`, {
    method: 'PATCH'
  }).pipe(
    flatMap(decodeBookmark)
  )

export const archiveBookmark = (
  baseUrl: URL,
  id: string
): Fx<BookmarkClientEffects, Bookmark> =>
  requestJson(baseUrl, `bookmarks/${encodeURIComponent(id)}/archive`, {
    method: 'PATCH'
  }).pipe(
    flatMap(decodeBookmark)
  )

export const refreshBookmarkMetadata = (
  baseUrl: URL,
  id: string
): Fx<BookmarkClientEffects, Bookmark> =>
  requestJson(baseUrl, `bookmarks/${encodeURIComponent(id)}/metadata/refresh`, {
    method: 'POST'
  }).pipe(
    flatMap(decodeBookmark)
  )

type RequestOptions = {
  readonly method?: 'GET' | 'POST' | 'PATCH'
  readonly body?: { readonly type: 'json'; readonly value: unknown }
  readonly query?: URLSearchParams
}

const requestJson = (
  baseUrl: URL,
  path: string,
  options: RequestOptions = {}
): Fx<HttpRequest | Async | Fail<BookmarkClientError>, JSONValue> =>
  request({
    method: options.method,
    url: apiUrl(baseUrl, path, options.query),
    body: options.body
  }).pipe(
    flatMap(expectSuccess),
    flatMap(json),
    catchAll(cause => fail({ tag: 'BookmarkRequestFailed', cause }))
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

const decodeBookmarks = (value: JSONValue): Fx<Fail<BookmarkClientError>, readonly Bookmark[]> =>
  withBookmarkCodecs(decode(BookmarksJson, value as readonly BookmarkWire[])).pipe(
    catchAll(() => invalidResponse<readonly Bookmark[]>(value))
  )

const decodeBookmark = (value: JSONValue): Fx<Fail<BookmarkClientError>, Bookmark> =>
  withBookmarkCodecs(decode(BookmarkJson, value as BookmarkWire)).pipe(
    catchAll(() => invalidResponse<Bookmark>(value))
  )

const invalidResponse = <A>(value: unknown): Fx<Fail<BookmarkClientError>, A> =>
  fail({ tag: 'InvalidBookmarkResponse', value })
