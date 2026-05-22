import { type Fx, ok } from '@briancavalier/fx'

import { codecFail, codecKey, codecOk, type CodecResult, type Decode, type Encode, withCodec } from '@briancavalier/fx/codec'
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

export const BookmarkJson = codecKey<Bookmark, string, InvalidBookmarkJson>()('examples/advanced/bookmarks/BookmarkJson', {
  description: 'Bookmark JSON with Date fields encoded as ISO strings'
})

export const BookmarksJson = codecKey<readonly Bookmark[], string, InvalidBookmarkJson>()('examples/advanced/bookmarks/BookmarksJson', {
  description: 'Bookmark array JSON with Date fields encoded as ISO strings'
})

export const AddBookmarkInputJson = codecKey<AddBookmarkInput, string, InvalidBookmarkJson>()('examples/advanced/bookmarks/AddBookmarkInputJson', {
  description: 'Add bookmark request JSON'
})

type BookmarkCodecEffects =
  | Encode<typeof BookmarkJson>
  | Decode<typeof BookmarkJson>
  | Encode<typeof BookmarksJson>
  | Decode<typeof BookmarksJson>
  | Encode<typeof AddBookmarkInputJson>
  | Decode<typeof AddBookmarkInputJson>

// This example uses a small hand-rolled JSON codec so the data boundary is easy
// to inspect without adding dependencies. A real application could keep the same
// codec keys and delegate these handlers to Zod, Valibot, Arktype, Effect
// Schema, a Standard Schema adapter, or a project-local parser/serializer.
export const withBookmarkCodecs = <E, A>(program: Fx<E, A>): Fx<Exclude<E, BookmarkCodecEffects>, A> => program.pipe(
  withCodec(BookmarkJson, {
    encode: bookmark => ok(encodeJson(bookmarkToWire(bookmark))),
    decode: text => ok(flatMapCodecResult(parseJson(text), decodeBookmarkWire))
  }),
  withCodec(BookmarksJson, {
    encode: bookmarks => ok(encodeJson(bookmarks.map(bookmarkToWire))),
    decode: text => ok(flatMapCodecResult(parseJson(text), decodeBookmarkWireArray))
  }),
  withCodec(AddBookmarkInputJson, {
    encode: input => ok(encodeJson(input)),
    decode: text => ok(flatMapCodecResult(parseJson(text), decodeAddBookmarkInputWire))
  })
) as Fx<Exclude<E, BookmarkCodecEffects>, A>

const decodeBookmarkWireArray = (values: unknown): CodecResult<InvalidBookmarkJson, readonly Bookmark[]> => {
  if (!Array.isArray(values)) return invalidBookmarkJson('expected bookmark array')

  const bookmarks: Bookmark[] = []
  for (const value of values) {
    const bookmark = parseBookmarkWire(value)
    if (bookmark === undefined) return invalidBookmarkJson('invalid bookmark JSON')
    bookmarks.push(bookmark)
  }
  return codecOk(bookmarks)
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

const decodeBookmarkWire = (value: unknown): CodecResult<InvalidBookmarkJson, Bookmark> => {
  const bookmark = parseBookmarkWire(value)
  return bookmark === undefined ? invalidBookmarkJson('invalid bookmark JSON') : codecOk(bookmark)
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

const decodeAddBookmarkInputWire = (value: unknown) => {
  if (!isRecord(value) || typeof value.url !== 'string') return invalidBookmarkJson('invalid add bookmark input JSON')

  if (value.tags === undefined) return codecOk({ url: value.url })

  return isStringArray(value.tags)
    ? codecOk({ url: value.url, tags: value.tags })
    : invalidBookmarkJson('invalid add bookmark input JSON')
}

const parseDate = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const invalidBookmarkJson = (message: string) =>
  codecFail(new InvalidBookmarkJson(message))

const encodeJson = (value: unknown): CodecResult<InvalidBookmarkJson, string> => {
  try {
    return codecOk(JSON.stringify(value))
  } catch {
    return invalidBookmarkJson('invalid bookmark JSON')
  }
}

const parseJson = (text: string): CodecResult<InvalidBookmarkJson, unknown> => {
  try {
    return codecOk(JSON.parse(text) as unknown)
  } catch {
    return invalidBookmarkJson('invalid bookmark JSON')
  }
}

const flatMapCodecResult = <E, A, B>(
  result: CodecResult<E, A>,
  f: (value: A) => CodecResult<E, B>
): CodecResult<E, B> =>
  result.tag === 'ok' ? f(result.value) : result

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
