import { type Async, catchAll, fail, type Fail, flatMap, type Fx, ok } from '@briancavalier/fx'

import { expectSuccess, json, request, type HttpRequest, type JSONValue } from '@briancavalier/fx/http-client'

import type { AddBookmarkInput, Bookmark, BookmarkQuery, BookmarkStatus, MetadataStatus } from './domain.js'

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
  Array.isArray(value)
    ? decodeBookmarkArray(value)
    : invalidResponse(value)

const decodeBookmarkArray = (values: readonly JSONValue[]): Fx<Fail<BookmarkClientError>, readonly Bookmark[]> => {
  const bookmarks: Bookmark[] = []
  for (const value of values) {
    const bookmark = parseBookmark(value)
    if (bookmark === undefined) return invalidResponse(value)
    bookmarks.push(bookmark)
  }
  return ok(bookmarks)
}

const decodeBookmark = (value: JSONValue): Fx<Fail<BookmarkClientError>, Bookmark> => {
  const bookmark = parseBookmark(value)
  return bookmark === undefined ? invalidResponse(value) : ok(bookmark)
}

const invalidResponse = <A>(value: unknown): Fx<Fail<BookmarkClientError>, A> =>
  fail({ tag: 'InvalidBookmarkResponse', value })

const parseBookmark = (value: unknown): Bookmark | undefined => {
  if (!isRecord(value)) return undefined

  const createdAt = parseDate(value.createdAt)
  const updatedAt = parseDate(value.updatedAt)

  return typeof value.id === 'string' &&
    typeof value.url === 'string' &&
    isStringArray(value.tags) &&
    isBookmarkStatus(value.status) &&
    isMetadataStatus(value.metadataStatus) &&
    createdAt !== undefined &&
    updatedAt !== undefined
    ? {
      id: value.id,
      url: value.url,
      title: typeof value.title === 'string' ? value.title : undefined,
      description: typeof value.description === 'string' ? value.description : undefined,
      tags: value.tags,
      status: value.status,
      metadataStatus: value.metadataStatus,
      createdAt,
      updatedAt
    }
    : undefined
}

const parseDate = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const isMetadataStatus = (value: unknown): value is MetadataStatus =>
  isRecord(value) &&
  (value.tag === 'not-requested' ||
    value.tag === 'available' ||
    (value.tag === 'failed' && typeof value.reason === 'string'))

const isBookmarkStatus = (value: unknown): value is BookmarkStatus =>
  value === 'unread' || value === 'read' || value === 'archived'

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
