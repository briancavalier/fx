import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unbounded } from '@briancavalier/fx/concurrent'
import { assert as assertNoFail, catchAll, Fail, flatMap, fx, type Fx, map, ok, provide, returnAll } from '@briancavalier/fx'

import { decodeOrFail, encodeOrFail, type Decode, type Encode } from '@briancavalier/fx/codec'
import { bytes as readBytes } from '@briancavalier/fx/http-client'
import { mount, route, routes, serve, transformRoutes, type RouteContext, type Routes, type ServerEvent, type ServerListening, type ServerRequest, type ServerResponse } from '@briancavalier/fx/http-server'
import { info, withConsoleLog, type Log } from '@briancavalier/fx/log'
import { nodeHttp, runNodeMain } from '@briancavalier/fx/platform-node'
import { defaultRandom } from '@briancavalier/fx/random'
import { forEachFrom, scope, yieldFrom, type Yielding } from '@briancavalier/fx/scope'
import { defaultTime, type Time } from '@briancavalier/fx/time'
import {
  addBookmark,
  archiveBookmark,
  demoPageMetadata,
  listBookmarks,
  markRead,
  randomBookmarkIds,
  refreshMetadata,
  type Bookmark,
  type BookmarkError,
  type BookmarkQuery,
  type BookmarkStatus,
  type BookmarkStore,
  type FetchPageMetadata,
  type NextBookmarkId
} from './domain.js'
import { AddBookmarkInputJson, BookmarkJson, BookmarksJson, InvalidBookmarkJson, withBookmarkCodecs } from './codec.js'
import { sqliteBookmarkStore } from './store-sqlite.js'

type ServerConfig = {
  readonly host: string
  readonly port: number
}

type BookmarkRouteEffects =
  | BookmarkStore
  | FetchPageMetadata
  | NextBookmarkId
  | Time
  | Log

type BookmarkApiCodecEffects =
  | Decode<typeof AddBookmarkInputJson>
  | Encode<typeof BookmarkJson>
  | Encode<typeof BookmarksJson>

const HttpServerEvents = scope<Yielding<ServerEvent>>()('examples/advanced/bookmarks/HttpServerEvents')

const createBookmark = (request: ServerRequest): Fx<BookmarkRouteEffects | BookmarkApiCodecEffects | Fail<InvalidBookmarkJson>, ServerResponse<never>> => fx(function* () {
  const body = yield* readText(request)
  const input = yield* decodeOrFail(AddBookmarkInputJson, body).pipe(
    returnAll
  )
  if (input instanceof InvalidBookmarkJson) return json({ error: 'InvalidBookmarkInput' }, 400)

  return yield* respond(addBookmark(input), bookmark => bookmarkResponse(bookmark, 201))
})

function withApiCodecs<E, A>(program: Fx<E, A>): Fx<Exclude<E, BookmarkApiCodecEffects | Fail<InvalidBookmarkJson>>, A> {
  return withBookmarkCodecs(program).pipe(
    assertNoFail
  ) as Fx<Exclude<E, BookmarkApiCodecEffects | Fail<InvalidBookmarkJson>>, A>
}

const apiRoutes = transformRoutes(withApiCodecs)(routes(
  route('GET', '/health', fx(function* () {
    return text('ok')
  })),

  route('POST', '/bookmarks', fx(function* ({ request }: RouteContext) {
    return yield* createBookmark(request)
  })),

  route('GET', '/bookmarks', fx(function* ({ request }: RouteContext) {
    const query = bookmarkQuery(request.query)
    if (query === undefined) return json({ error: 'InvalidBookmarkQuery' }, 400)
    return yield* respond(listBookmarks(query), bookmarksResponse)
  })),

  route('PATCH', '/bookmarks/:id/read', fx(function* ({ request }: RouteContext<{ readonly id: string }>) {
    return yield* respond(markRead(request.params.id), bookmarkResponse)
  })),

  route('PATCH', '/bookmarks/:id/archive', fx(function* ({ request }: RouteContext<{ readonly id: string }>) {
    return yield* respond(archiveBookmark(request.params.id), bookmarkResponse)
  })),

  route('POST', '/bookmarks/:id/metadata/refresh', fx(function* ({ request }: RouteContext<{ readonly id: string }>) {
    return yield* respond(refreshMetadata(request.params.id), bookmarkResponse)
  }))
))

const browserDir = join(dirname(fileURLToPath(import.meta.url)), 'browser')

const browserRoutes = routes(
  route('GET', '/', fx(function* () {
    return fileResponse('index.html', 'text/html; charset=utf-8')
  })),
  route('GET', '/bookmarks/styles.css', fx(function* () {
    return fileResponse('styles.css', 'text/css; charset=utf-8')
  })),
  route('GET', '/bookmarks/assets/*', fx(function* ({ request }: RouteContext<{ readonly '*': string }>) {
    return assetResponse(request.params['*'] ?? '')
  }))
)

const appRoutes = routes(
  browserRoutes,
  mount('/api', apiRoutes as Routes<BookmarkRouteEffects>)
)

const server = fx(function* ({ host, port }: ServerConfig) {
  return yield* serve(appRoutes, {
    host,
    port,
    observe: event => yieldFrom(HttpServerEvents, event)
  })
})

const respond = <E, A, SE>(
  program: Fx<E, A>,
  success: (value: A) => Fx<SE, ServerResponse<never>>
): Fx<Exclude<E, Fail<BookmarkError>> | SE, ServerResponse<never>> =>
  program.pipe(
    returnAll,
    flatMap(result => isBookmarkError(result)
      ? ok(bookmarkErrorResponse(result))
      : success(result))
  ) as Fx<Exclude<E, Fail<BookmarkError>> | SE, ServerResponse<never>>

const bookmarkQuery = (query: URLSearchParams): BookmarkQuery | undefined => {
  const status = query.get('status') ?? undefined
  if (status !== undefined && !isBookmarkQueryStatus(status)) return undefined

  return {
    status,
    tag: query.get('tag') ?? undefined,
    text: query.get('text') ?? undefined
  }
}

const isBookmarkQueryStatus = (status: string): status is BookmarkStatus | 'all' =>
  status === 'unread' || status === 'read' || status === 'archived' || status === 'all'

const bookmarkErrorResponse = (error: BookmarkError): ServerResponse<never> => {
  switch (error.tag) {
    case 'InvalidUrl':
      return json(error, 400)

    case 'DuplicateBookmark':
      return json(error, 400)

    case 'BookmarkNotFound':
      return json(error, 404)
  }
}

const isBookmarkError = (value: unknown): value is BookmarkError =>
  isRecord(value) &&
  (value.tag === 'InvalidUrl' || value.tag === 'DuplicateBookmark' || value.tag === 'BookmarkNotFound')

const text = (value: string, status = 200): ServerResponse<never> => ({
  status,
  headers: [['content-type', 'text/plain; charset=utf-8']],
  body: { type: 'text', value }
})

const fileResponse = (path: string, contentType: string): ServerResponse<never> => {
  const file = readStaticFile(path)
  return file === undefined
    ? text('Not Found', 404)
    : {
      status: 200,
      headers: [['content-type', contentType]],
      body: { type: 'bytes', value: file }
    }
}

const assetResponse = (path: string): ServerResponse<never> => {
  const normalized = normalize(path)
  if (normalized.startsWith(sep) || normalized.startsWith('..') || normalized.includes(`${sep}..${sep}`)) {
    return text('Not Found', 404)
  }

  const contentType = normalized.endsWith('.js')
    ? 'text/javascript; charset=utf-8'
    : normalized.endsWith('.map')
      ? 'application/json'
      : 'application/octet-stream'

  return fileResponse(join('assets', normalized), contentType)
}

const readStaticFile = (path: string): Uint8Array | undefined => {
  try {
    return readFileSync(join(browserDir, path))
  } catch {
    return undefined
  }
}

const json = (value: unknown, status = 200): ServerResponse<never> => ({
  status,
  body: { type: 'json', value }
})

const jsonText = (value: string, status = 200): ServerResponse<never> => ({
  status,
  headers: [['content-type', 'application/json']],
  body: { type: 'text', value }
})

const bookmarkResponse = (bookmark: Bookmark, status = 200): Fx<Encode<typeof BookmarkJson> | Fail<InvalidBookmarkJson>, ServerResponse<never>> =>
  encodeOrFail(BookmarkJson, bookmark).pipe(
    map(value => jsonText(value, status))
  )

const bookmarksResponse = (bookmarks: readonly Bookmark[]): Fx<Encode<typeof BookmarksJson> | Fail<InvalidBookmarkJson>, ServerResponse<never>> =>
  encodeOrFail(BookmarksJson, bookmarks).pipe(
    map(jsonText)
  )

const readText = (request: ServerRequest): Fx<never, string> =>
  readBytes({ status: 200, headers: [], body: request.body }).pipe(
    map((bytes: Uint8Array) => new TextDecoder().decode(bytes)),
    catchAll(() => ok(''))
  ) as Fx<never, string>

const logHttpServerEvent = (event: ServerEvent) => {
  switch (event.type) {
    case 'listening':
      return info('Bookmark UI ready', {
        timestamp: event.timestamp,
        ...addressData(event.address)
      })

    case 'request':
      return info('HTTP request', {
        timestamp: event.timestamp,
        method: event.method,
        path: event.path,
        status: event.status,
        durationMs: Math.round(event.durationMs)
      })

    case 'requestFailed':
      return info('HTTP request failed', {
        timestamp: event.timestamp,
        method: event.method,
        path: event.path,
        status: event.status,
        durationMs: Math.round(event.durationMs),
        error: event.error
      })

    case 'closed':
      return info('HTTP server closed', { timestamp: event.timestamp })
  }
}

const addressData = (address: ServerListening['address']) =>
  address === null
    ? {}
    : {
      host: address.host,
      port: address.port,
      url: browserUrl(address),
      bindUrl: bindUrl(address),
      networkUrls: networkUrls(address.port)
    }

const browserUrl = ({ host, port }: NonNullable<ServerListening['address']>): string =>
  `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/`

const bindUrl = ({ host, port }: NonNullable<ServerListening['address']>): string =>
  `http://${host}:${port}/`

const networkUrls = (port: number): readonly string[] => {
  const urls: string[] = []

  for (const interfaces of Object.values(networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      urls.push(`http://${address.address}:${port}/`)
    }
  }

  return urls
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

await server.pipe(
  nodeHttp(),
  f => forEachFrom(HttpServerEvents, f, logHttpServerEvent),
  sqliteBookmarkStore(process.env.BOOKMARKS_DB ?? 'bookmarks.sqlite'),
  demoPageMetadata,
  randomBookmarkIds,
  withConsoleLog,
  defaultTime,
  defaultRandom(),
  assertNoFail,
  provide({
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3000)
  }),
  unbounded,
  runNodeMain
)
