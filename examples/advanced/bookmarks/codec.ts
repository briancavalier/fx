import { fail, type Fail, type Fx, ok } from '@briancavalier/fx'

import { codecKey, type Decode, type Encode, withCodec } from '@briancavalier/fx/codec'
import type { AddBookmarkInput, Bookmark, BookmarkStatus, MetadataStatus } from './domain.js'

export type BookmarkWire = {
  readonly id: string
  readonly url: string
  readonly title?: string
  readonly description?: string
  readonly tags: readonly string[]
  readonly status: BookmarkStatus
  readonly metadataStatus: MetadataStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export type AddBookmarkInputWire = {
  readonly url: string
  readonly tags?: readonly string[]
}

export class InvalidBookmarkJson extends Error { }

export const BookmarkJson = codecKey<Bookmark, BookmarkWire>()(Symbol('examples/advanced/bookmarks/BookmarkJson'), {
  description: 'Bookmark JSON with Date fields encoded as ISO strings'
})

export const BookmarksJson = codecKey<readonly Bookmark[], readonly BookmarkWire[]>()(Symbol('examples/advanced/bookmarks/BookmarksJson'), {
  description: 'Bookmark array JSON with Date fields encoded as ISO strings'
})

export const AddBookmarkInputJson = codecKey<AddBookmarkInput, AddBookmarkInputWire>()(Symbol('examples/advanced/bookmarks/AddBookmarkInputJson'), {
  description: 'Add bookmark request JSON'
})

type BookmarkCodecEffects =
  | Encode<typeof BookmarkJson>
  | Decode<typeof BookmarkJson>
  | Encode<typeof BookmarksJson>
  | Decode<typeof BookmarksJson>
  | Encode<typeof AddBookmarkInputJson>
  | Decode<typeof AddBookmarkInputJson>

export const withBookmarkCodecs = <E extends BookmarkCodecEffects, A>(program: Fx<E, A>): Fx<Fail<InvalidBookmarkJson>, A> => program.pipe(
  withCodec(BookmarkJson, {
    encode: bookmark => ok(bookmarkToWire(bookmark)),
    decode: decodeBookmarkWire
  }),
  withCodec(BookmarksJson, {
    encode: bookmarks => ok(bookmarks.map(bookmarkToWire)),
    decode: decodeBookmarkWireArray
  }),
  withCodec(AddBookmarkInputJson, {
    encode: input => ok(input),
    decode: decodeAddBookmarkInputWire
  })
) as Fx<Fail<InvalidBookmarkJson>, A>

const decodeBookmarkWireArray = (values: readonly BookmarkWire[]): Fx<Fail<InvalidBookmarkJson>, readonly Bookmark[]> => {
  if (!Array.isArray(values)) return invalidBookmarkJson('expected bookmark array')

  const bookmarks: Bookmark[] = []
  for (const value of values) {
    const bookmark = parseBookmarkWire(value)
    if (bookmark === undefined) return invalidBookmarkJson('invalid bookmark JSON')
    bookmarks.push(bookmark)
  }
  return ok(bookmarks)
}

const bookmarkToWire = (bookmark: Bookmark): BookmarkWire => ({
  id: bookmark.id,
  url: bookmark.url,
  ...(bookmark.title === undefined ? {} : { title: bookmark.title }),
  ...(bookmark.description === undefined ? {} : { description: bookmark.description }),
  tags: bookmark.tags,
  status: bookmark.status,
  metadataStatus: bookmark.metadataStatus,
  createdAt: bookmark.createdAt.toISOString(),
  updatedAt: bookmark.updatedAt.toISOString()
})

const decodeBookmarkWire = (value: BookmarkWire): Fx<Fail<InvalidBookmarkJson>, Bookmark> => {
  const bookmark = parseBookmarkWire(value)
  return bookmark === undefined ? invalidBookmarkJson('invalid bookmark JSON') : ok(bookmark)
}

const parseBookmarkWire = (value: unknown): Bookmark | undefined => {
  if (!isRecord(value)) return undefined

  const createdAt = parseDate(value.createdAt)
  const updatedAt = parseDate(value.updatedAt)

  return typeof value.id === 'string' &&
    typeof value.url === 'string' &&
    isOptionalString(value.title) &&
    isOptionalString(value.description) &&
    isStringArray(value.tags) &&
    isBookmarkStatus(value.status) &&
    isMetadataStatus(value.metadataStatus) &&
    createdAt !== undefined &&
    updatedAt !== undefined
    ? {
      id: value.id,
      url: value.url,
      title: value.title,
      description: value.description,
      tags: value.tags,
      status: value.status,
      metadataStatus: value.metadataStatus,
      createdAt,
      updatedAt
    }
    : undefined
}

const decodeAddBookmarkInputWire = (value: AddBookmarkInputWire) => {
  if (!isRecord(value) || typeof value.url !== 'string') return invalidBookmarkJson('invalid add bookmark input JSON')

  if (value.tags === undefined) return ok({ url: value.url })

  return isStringArray(value.tags)
    ? ok({ url: value.url, tags: value.tags })
    : invalidBookmarkJson('invalid add bookmark input JSON')
}

const parseDate = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const invalidBookmarkJson = (message: string) =>
  fail(new InvalidBookmarkJson(message))

const isMetadataStatus = (value: unknown): value is MetadataStatus =>
  isRecord(value) &&
  (value.tag === 'not-requested' ||
    value.tag === 'available' ||
    (value.tag === 'failed' && typeof value.reason === 'string'))

const isBookmarkStatus = (value: unknown): value is BookmarkStatus =>
  value === 'unread' || value === 'read' || value === 'archived'

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
