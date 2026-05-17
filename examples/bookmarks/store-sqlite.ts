import { DatabaseSync } from 'node:sqlite'
import { ok, type Fx } from '../../src/Fx.js'
import { handle } from '../../src/Handler.js'
import {
  FindBookmarkById,
  FindBookmarkByUrl,
  ListBookmarks,
  SaveBookmark,
  type Bookmark,
  type BookmarkQuery,
  type BookmarkStatus,
  type MetadataStatus
} from './domain.js'

type BookmarkRow = {
  readonly id: string
  readonly url: string
  readonly title: string | null
  readonly description: string | null
  readonly tags: string
  readonly status: string
  readonly metadata_status: string
  readonly created_at: string
  readonly updated_at: string
}

export const sqliteBookmarkStore = (path: string) => {
  const db = new DatabaseSync(path)
  initialize(db)

  const selectById = db.prepare('select * from bookmarks where id = ?')
  const selectByUrl = db.prepare(`
    select * from bookmarks
    where url = ?
    order by status = 'archived', created_at, id
    limit 1
  `)
  const selectAll = db.prepare('select * from bookmarks order by created_at, id')
  const selectByStatus = db.prepare('select * from bookmarks where status = ? order by created_at, id')
  const save = db.prepare(`
    insert into bookmarks (
      id,
      url,
      title,
      description,
      tags,
      status,
      metadata_status,
      created_at,
      updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      url = excluded.url,
      title = excluded.title,
      description = excluded.description,
      tags = excluded.tags,
      status = excluded.status,
      metadata_status = excluded.metadata_status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `)

  const handleBookmarkStore = <E, A>(program: Fx<E, A>) => program.pipe(
    handle(FindBookmarkById, effect => ok(bookmarkFromRow(selectById.get(effect.arg)))),
    handle(FindBookmarkByUrl, effect => ok(bookmarkFromRow(selectByUrl.get(effect.arg)))),
    handle(ListBookmarks, effect => ok(listBookmarks(selectAll, selectByStatus, effect.arg))),
    handle(SaveBookmark, effect => {
      save.run(
        effect.arg.id,
        effect.arg.url,
        effect.arg.title ?? null,
        effect.arg.description ?? null,
        JSON.stringify(effect.arg.tags),
        effect.arg.status,
        JSON.stringify(effect.arg.metadataStatus),
        effect.arg.createdAt.toISOString(),
        effect.arg.updatedAt.toISOString()
      )
      return ok(effect.arg)
    })
  )

  return handleBookmarkStore
}

const initialize = (db: DatabaseSync): void => {
  db.exec(`
    create table if not exists bookmarks (
      id text primary key,
      url text not null,
      title text,
      description text,
      tags text not null,
      status text not null,
      metadata_status text not null,
      created_at text not null,
      updated_at text not null
    )
  `)
}

const listBookmarks = (
  selectAll: ReturnType<DatabaseSync['prepare']>,
  selectByStatus: ReturnType<DatabaseSync['prepare']>,
  query: BookmarkQuery
): readonly Bookmark[] => {
  const status = query.status === 'all' ? undefined : query.status
  const rows = status === undefined
    ? selectAll.all()
    : selectByStatus.all(status)
  const tag = query.tag?.trim() || undefined
  const text = query.text?.trim().toLocaleLowerCase() || undefined

  return rows
    .map(row => bookmarkFromRow(row))
    .filter(bookmark => bookmark !== undefined)
    .filter(bookmark => tag === undefined || bookmark.tags.includes(tag))
    .filter(bookmark => text === undefined || bookmarkMatchesText(bookmark, text))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
}

const bookmarkFromRow = (row: unknown): Bookmark | undefined => {
  if (row === undefined) return undefined
  if (!isBookmarkRow(row)) throw new Error('Malformed bookmark row')

  const tags = parseTags(row.tags)
  const metadataStatus = parseMetadataStatus(row.metadata_status)
  const status = parseBookmarkStatus(row.status)
  const createdAt = parseDate(row.created_at)
  const updatedAt = parseDate(row.updated_at)

  if (
    tags === undefined ||
    metadataStatus === undefined ||
    status === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    throw new Error(`Malformed bookmark row: ${row.id}`)
  }

  return {
    id: row.id,
    url: row.url,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    tags,
    status,
    metadataStatus,
    createdAt,
    updatedAt
  }
}

const bookmarkMatchesText = (bookmark: Bookmark, text: string): boolean =>
  bookmark.url.toLocaleLowerCase().includes(text) ||
    bookmark.title?.toLocaleLowerCase().includes(text) === true ||
    bookmark.description?.toLocaleLowerCase().includes(text) === true

const parseTags = (value: string): readonly string[] | undefined => {
  const tags = parseJson(value)
  return Array.isArray(tags) && tags.every(tag => typeof tag === 'string')
    ? tags
    : undefined
}

const parseMetadataStatus = (value: string): MetadataStatus | undefined => {
  const status = parseJson(value)
  return isMetadataStatus(status) ? status : undefined
}

const parseBookmarkStatus = (value: string): BookmarkStatus | undefined =>
  value === 'unread' || value === 'read' || value === 'archived'
    ? value
    : undefined

const parseDate = (value: string): Date | undefined => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const isBookmarkRow = (value: unknown): value is BookmarkRow =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.url === 'string' &&
  (typeof value.title === 'string' || value.title === null) &&
  (typeof value.description === 'string' || value.description === null) &&
  typeof value.tags === 'string' &&
  typeof value.status === 'string' &&
  typeof value.metadata_status === 'string' &&
  typeof value.created_at === 'string' &&
  typeof value.updated_at === 'string'

const isMetadataStatus = (value: unknown): value is MetadataStatus =>
  isRecord(value) &&
  (value.tag === 'not-requested' ||
    value.tag === 'available' ||
    (value.tag === 'failed' && typeof value.reason === 'string'))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
