import { fail, type Fail } from '../../src/Fail.js'
import { fx, map, ok, type Fx } from '../../src/Fx.js'
import { handle } from '../../src/Handler.js'
import { info, type Log } from '../../src/Log.js'
import { int } from '../../src/Random.js'
import { now, type Time } from '../../src/Time.js'
import { Effect } from '../../src/index.js'

export type BookmarkId = string

export type BookmarkStatus =
  | 'unread'
  | 'read'
  | 'archived'

export interface Bookmark {
  readonly id: BookmarkId
  readonly url: string
  readonly title?: string
  readonly description?: string
  readonly tags: readonly string[]
  readonly status: BookmarkStatus
  readonly metadataStatus: MetadataStatus
  readonly createdAt: Date
  readonly updatedAt: Date
}

export type MetadataStatus =
  | { readonly tag: 'not-requested' }
  | { readonly tag: 'available' }
  | { readonly tag: 'failed'; readonly reason: string }

export interface PageMetadata {
  readonly title?: string
  readonly description?: string
}

export type MetadataResult =
  | { readonly tag: 'available'; readonly metadata: PageMetadata }
  | { readonly tag: 'failed'; readonly reason: string }

export interface BookmarkQuery {
  readonly status?: BookmarkStatus | 'all'
  readonly tag?: string
  readonly text?: string
}

export interface AddBookmarkInput {
  readonly url: string
  readonly tags?: readonly string[]
}

export type BookmarkError =
  | { readonly tag: 'InvalidUrl'; readonly input: string }
  | { readonly tag: 'DuplicateBookmark'; readonly url: string; readonly id: BookmarkId }
  | { readonly tag: 'BookmarkNotFound'; readonly id: BookmarkId }

/**
 * Request bookmark persistence without choosing a storage backend.
 */
export class FindBookmarkById extends Effect('example/Bookmarks/FindBookmarkById')<BookmarkId, Bookmark | undefined> { }
export class FindBookmarkByUrl extends Effect('example/Bookmarks/FindBookmarkByUrl')<string, Bookmark | undefined> { }
export class ListBookmarks extends Effect('example/Bookmarks/ListBookmarks')<BookmarkQuery, readonly Bookmark[]> { }
export class SaveBookmark extends Effect('example/Bookmarks/SaveBookmark')<Bookmark, Bookmark> { }

/**
 * Request page metadata for a bookmark URL.
 */
export class FetchPageMetadata extends Effect('example/Bookmarks/FetchPageMetadata')<string, MetadataResult> { }

/**
 * Request a new bookmark id.
 */
export class NextBookmarkId extends Effect('example/Bookmarks/NextBookmarkId')<void, BookmarkId> { }

export type BookmarkStore =
  | FindBookmarkById
  | FindBookmarkByUrl
  | ListBookmarks
  | SaveBookmark

export type BookmarkEffects =
  | BookmarkStore
  | FetchPageMetadata
  | NextBookmarkId
  | Time
  | Log
  | Fail<BookmarkError>

export const findBookmarkById = (id: BookmarkId) => new FindBookmarkById(id)
export const findBookmarkByUrl = (url: string) => new FindBookmarkByUrl(url)
export const listStoredBookmarks = (query: BookmarkQuery = {}) => new ListBookmarks(query)
export const saveBookmark = (bookmark: Bookmark) => new SaveBookmark(bookmark)
export const fetchPageMetadata = (url: string) => new FetchPageMetadata(url)
export const nextBookmarkId = new NextBookmarkId()

export const addBookmark = (input: AddBookmarkInput): Fx<BookmarkEffects, Bookmark> => fx(function* () {
  const url = yield* normalizeUrl(input.url)
  const existing = yield* findBookmarkByUrl(url)

  if (existing !== undefined && existing.status !== 'archived') {
    return yield* fail({ tag: 'DuplicateBookmark', url, id: existing.id })
  }

  const id = yield* nextBookmarkId
  const timestamp = new Date(yield* now)
  const metadata = yield* fetchPageMetadata(url)
  const bookmark = yield* saveBookmark({
    ...pageMetadataFields(metadata),
    id,
    url,
    tags: normalizeTags(input.tags ?? []),
    status: 'unread',
    metadataStatus: metadataStatus(metadata),
    createdAt: timestamp,
    updatedAt: timestamp
  })

  yield* info('Bookmark added', { id, url })
  return bookmark
})

export const listBookmarks = (query: BookmarkQuery = {}): Fx<BookmarkStore, readonly Bookmark[]> =>
  listStoredBookmarks(normalizeQuery(query))

export const markRead = (id: BookmarkId): Fx<BookmarkStore | Time | Log | Fail<BookmarkError>, Bookmark> =>
  updateBookmark(id, bookmark => ok({
    ...bookmark,
    status: 'read'
  }), 'Bookmark marked read')

export const archiveBookmark = (id: BookmarkId): Fx<BookmarkStore | Time | Log | Fail<BookmarkError>, Bookmark> =>
  updateBookmark(id, bookmark => ok({
    ...bookmark,
    status: 'archived'
  }), 'Bookmark archived')

export const refreshMetadata = (id: BookmarkId): Fx<BookmarkStore | FetchPageMetadata | Time | Log | Fail<BookmarkError>, Bookmark> =>
  updateBookmark(id, bookmark => fx(function* () {
    const metadata = yield* fetchPageMetadata(bookmark.url)
    return {
      ...bookmark,
      ...pageMetadataFields(metadata),
      metadataStatus: metadataStatus(metadata)
    }
  }), 'Bookmark metadata refreshed')

const updateBookmark = <E>(
  id: BookmarkId,
  update: (bookmark: Bookmark) => Fx<E, Bookmark>,
  message: string
): Fx<BookmarkStore | Time | Log | Fail<BookmarkError> | E, Bookmark> => fx(function* () {
  const bookmark = yield* findBookmarkById(id)
  if (bookmark === undefined) {
    return yield* fail({ tag: 'BookmarkNotFound', id })
  }

  const updated = yield* update(bookmark)
  const timestamped = yield* saveBookmark({
    ...updated,
    updatedAt: new Date(yield* now)
  })

  yield* info(message, { id })
  return timestamped
})

export const memoryBookmarkStore = (initial: readonly Bookmark[] = []) => {
  const bookmarks = new Map<BookmarkId, Bookmark>()
  for (const bookmark of initial) bookmarks.set(bookmark.id, bookmark)

  const handleBookmarkStore = <E, A>(program: Fx<E, A>) => program.pipe(
    handle(FindBookmarkById, effect => ok(bookmarks.get(effect.arg))),
    handle(FindBookmarkByUrl, effect => ok(findByUrl(bookmarks, effect.arg))),
    handle(ListBookmarks, effect => ok(filterBookmarks(bookmarks, effect.arg))),
    handle(SaveBookmark, effect => {
      bookmarks.set(effect.arg.id, effect.arg)
      return ok(effect.arg)
    })
  )

  return handleBookmarkStore
}

export const stubPageMetadata = (
  metadata: Readonly<Record<string, MetadataResult | PageMetadata>>
) =>
  handle(FetchPageMetadata, effect => {
    const result = metadata[effect.arg]
    return ok(result === undefined
      ? { tag: 'failed', reason: 'No stub metadata configured' }
      : isMetadataResult(result)
        ? result
        : { tag: 'available', metadata: result })
  })

export const demoPageMetadata = handle(FetchPageMetadata, effect => {
  const url = new URL(effect.arg)
  const path = url.pathname === '/' ? '' : url.pathname
  return ok({
    tag: 'available',
    metadata: {
      title: `${url.hostname}${path}`,
      description: `Saved from ${url.origin}`
    }
  })
})

export const deterministicBookmarkIds = (ids: readonly BookmarkId[]) => {
  let index = 0

  const handleBookmarkIds = handle(NextBookmarkId, () => {
    const id = ids[index] ?? `bookmark-${index + 1}`
    index += 1
    return ok(id)
  })

  return handleBookmarkIds
}

export const randomBookmarkIds = handle(NextBookmarkId, () =>
  int().pipe(
    map(id => `bookmark-${id.toString(16).padStart(8, '0')}`)
  )
)

const normalizeUrl = (input: string): Fx<Fail<BookmarkError>, string> => {
  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return fail({ tag: 'InvalidUrl', input })
    }
    url.hash = ''
    return ok(url.href)
  } catch {
    return fail({ tag: 'InvalidUrl', input })
  }
}

const normalizeTags = (tags: readonly string[]): readonly string[] => {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const tag of tags) {
    const value = tag.trim()
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

const normalizeQuery = (query: BookmarkQuery): BookmarkQuery => ({
  ...query,
  tag: query.tag?.trim() || undefined,
  text: query.text?.trim() || undefined
})

const metadataStatus = (result: MetadataResult): MetadataStatus =>
  result.tag === 'available'
    ? { tag: 'available' }
    : { tag: 'failed', reason: result.reason }

const pageMetadataFields = (result: MetadataResult): Pick<Bookmark, 'title' | 'description'> =>
  result.tag === 'available'
    ? result.metadata
    : {}

const findByUrl = (bookmarks: Map<BookmarkId, Bookmark>, url: string): Bookmark | undefined =>
  [...bookmarks.values()].find(bookmark => bookmark.url === url)

const filterBookmarks = (bookmarks: Map<BookmarkId, Bookmark>, query: BookmarkQuery): readonly Bookmark[] => {
  const normalized = normalizeQuery(query)
  const tag = normalized.tag
  const text = normalized.text?.toLocaleLowerCase()

  return [...bookmarks.values()]
    .filter(bookmark => normalized.status === undefined || normalized.status === 'all' || bookmark.status === normalized.status)
    .filter(bookmark => tag === undefined || bookmark.tags.includes(tag))
    .filter(bookmark => text === undefined || bookmarkMatchesText(bookmark, text))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
}

const bookmarkMatchesText = (bookmark: Bookmark, text: string): boolean =>
  bookmark.url.toLocaleLowerCase().includes(text) ||
    bookmark.title?.toLocaleLowerCase().includes(text) === true ||
    bookmark.description?.toLocaleLowerCase().includes(text) === true

const isMetadataResult = (value: MetadataResult | PageMetadata): value is MetadataResult =>
  'tag' in value && (value.tag === 'available' || value.tag === 'failed')
