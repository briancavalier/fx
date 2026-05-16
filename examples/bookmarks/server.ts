import { unbounded } from '../../src/Concurrent.js'
import { provide } from '../../src/Env.js'
import { assert as assertNoFail, catchAll, returnAll, type Fail } from '../../src/Fail.js'
import { flatMap, fx, map, ok, trySync, type Fx } from '../../src/Fx.js'
import { bytes as readBytes } from '../../src/HttpClient.js'
import { mount, route, routes, serve, type Routes, type ServerEvent, type ServerListening, type ServerRequest, type ServerResponse } from '../../src/HttpServer.js'
import { info, console as logConsole, type Log } from '../../src/Log.js'
import { nodeHttp, runNodeMain } from '../../src/platform-node.js'
import { defaultRandom } from '../../src/Random.js'
import { emit, forEach as forEachStream } from '../../src/Stream.js'
import { defaultTime, type Time } from '../../src/Time.js'
import {
  addBookmark,
  archiveBookmark,
  demoPageMetadata,
  listBookmarks,
  markRead,
  memoryBookmarkStore,
  randomBookmarkIds,
  refreshMetadata,
  type AddBookmarkInput,
  type BookmarkError,
  type BookmarkQuery,
  type BookmarkStatus,
  type BookmarkStore,
  type FetchPageMetadata,
  type NextBookmarkId
} from './domain.js'

type ServerConfig = {
  readonly port: number
}

type JsonBody =
  | { readonly tag: 'valid'; readonly value: unknown }
  | { readonly tag: 'invalid' }

type BookmarkRouteEffects =
  | BookmarkStore
  | FetchPageMetadata
  | NextBookmarkId
  | Time
  | Log

const createBookmark = (request: ServerRequest): Fx<BookmarkRouteEffects, ServerResponse<never>> => fx(function* () {
  const body = yield* readJson(request)
  if (body.tag === 'invalid') return json({ error: 'InvalidJson' }, 400)

  const input = addBookmarkInput(body.value)
  if (input === undefined) return json({ error: 'InvalidBookmarkInput' }, 400)

  return yield* respond(addBookmark(input), bookmark => json(bookmark, 201))
})

const apiRoutes = routes(
  route<BookmarkRouteEffects>('GET', '/health', () => ok(text('ok'))),

  route<BookmarkRouteEffects>('POST', '/bookmarks', createBookmark),

  route<BookmarkRouteEffects>('GET', '/bookmarks', request => {
    const query = bookmarkQuery(request.query)
    return query === undefined
      ? ok(json({ error: 'InvalidBookmarkQuery' }, 400))
      : respond(listBookmarks(query), json)
  }),

  route<BookmarkRouteEffects>('PATCH', '/bookmarks/:id/read', request =>
    respond(markRead(request.params.id), json)),

  route<BookmarkRouteEffects>('PATCH', '/bookmarks/:id/archive', request =>
    respond(archiveBookmark(request.params.id), json)),

  route<BookmarkRouteEffects>('POST', '/bookmarks/:id/metadata/refresh', request =>
    respond(refreshMetadata(request.params.id), json))
)

const appRoutes = mount('/api', apiRoutes as Routes<BookmarkRouteEffects>)

const server = fx(function* ({ port }: ServerConfig) {
  return yield* serve(appRoutes, {
    host: '127.0.0.1',
    port,
    observe: event => emit(event)
  })
})

const respond = <E, A>(
  program: Fx<E, A>,
  success: (value: A) => ServerResponse<never>
): Fx<Exclude<E, Fail<BookmarkError>>, ServerResponse<never>> =>
  program.pipe(
    returnAll,
    map(result => isBookmarkError(result)
      ? bookmarkErrorResponse(result)
      : success(result))
  ) as Fx<Exclude<E, Fail<BookmarkError>>, ServerResponse<never>>

const addBookmarkInput = (value: unknown): AddBookmarkInput | undefined => {
  if (!isRecord(value) || typeof value.url !== 'string') return undefined

  if (value.tags === undefined) return { url: value.url }

  return Array.isArray(value.tags) && value.tags.every(tag => typeof tag === 'string')
    ? { url: value.url, tags: value.tags }
    : undefined
}

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

const json = (value: unknown, status = 200): ServerResponse<never> => ({
  status,
  body: { type: 'json', value }
})

const readJson = (request: ServerRequest): Fx<never, JsonBody> =>
  readBytes({ status: 200, headers: [], body: request.body }).pipe(
    map((bytes: Uint8Array) => new TextDecoder().decode(bytes)),
    flatMap(parseJsonBody),
    catchAll(() => ok({ tag: 'invalid' } as const))
  ) as Fx<never, JsonBody>

const parseJsonBody = (body: string): Fx<Fail<unknown>, JsonBody> =>
  trySync(() => ({ tag: 'valid', value: JSON.parse(body) }))

const logHttpServerEvent = (event: ServerEvent) => {
  switch (event.type) {
    case 'listening':
      return info('HTTP server ready', {
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
    : { host: address.host, port: address.port }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

await server.pipe(
  nodeHttp(),
  f => forEachStream(f, logHttpServerEvent),
  memoryBookmarkStore(),
  demoPageMetadata,
  randomBookmarkIds,
  logConsole,
  defaultTime,
  defaultRandom(),
  assertNoFail,
  provide({ port: Number(process.env.PORT ?? 3000) }),
  unbounded,
  runNodeMain
)
