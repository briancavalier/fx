import * as assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { returnAll } from '../../src/Fail.js'
import { runPromise, type Fx } from '../../src/Fx.js'
import { collect } from '../../src/Log.js'
import { withClock, type Time } from '../../src/Time.js'
import { VirtualClock } from '../../src/internal/time.js'
import {
  addBookmark,
  deterministicBookmarkIds,
  findBookmarkById,
  findBookmarkByUrl,
  listBookmarks,
  markRead,
  saveBookmark,
  stubPageMetadata,
  type Bookmark,
  type BookmarkEffects,
  type BookmarkError,
  type FetchPageMetadata,
  type MetadataResult
} from './domain.js'
import { sqliteBookmarkStore } from './store-sqlite.js'

describe('sqlite bookmark store', () => {
  it('saves and loads bookmarks by id', async () => {
    const { path, cleanup } = tempDatabase()
    try {
      const bookmark = bookmarkFixture({ id: 'bookmark-1' })
      const saved = await runStore(path, saveBookmark(bookmark))
      const found = await runStore(path, findBookmarkById(bookmark.id))

      assert.deepEqual(saved, bookmark)
      assert.deepEqual(found, bookmark)
    } finally {
      await cleanup()
    }
  })

  it('finds bookmarks by URL', async () => {
    const { path, cleanup } = tempDatabase()
    try {
      const bookmark = bookmarkFixture({ url: 'https://example.com/read' })

      await runStore(path, saveBookmark(bookmark))

      assert.deepEqual(await runStore(path, findBookmarkByUrl(bookmark.url)), bookmark)
      assert.equal(await runStore(path, findBookmarkByUrl('https://example.com/missing')), undefined)
    } finally {
      await cleanup()
    }
  })

  it('lists bookmarks by status, tag, and text', async () => {
    const { path, cleanup } = tempDatabase()
    try {
      const first = bookmarkFixture({
        id: 'bookmark-1',
        url: 'https://example.com/typescript',
        tags: ['typescript'],
        title: 'TypeScript effects'
      })
      const second = bookmarkFixture({
        id: 'bookmark-2',
        url: 'https://example.com/archive',
        tags: ['effects'],
        status: 'read',
        title: 'Reading queue'
      })

      await runStore(path, saveBookmark(second))
      await runStore(path, saveBookmark(first))

      assert.deepEqual(ids(await runStore(path, listBookmarks({ status: 'unread' }))), [first.id])
      assert.deepEqual(ids(await runStore(path, listBookmarks({ tag: 'effects' }))), [second.id])
      assert.deepEqual(ids(await runStore(path, listBookmarks({ text: 'typescript' }))), [first.id])
    } finally {
      await cleanup()
    }
  })

  it('persists bookmarks across handler instances', async () => {
    const { path, cleanup } = tempDatabase()
    try {
      const bookmark = bookmarkFixture({ id: 'bookmark-1' })

      await runStore(path, saveBookmark(bookmark))

      assert.deepEqual(await runStore(path, findBookmarkById(bookmark.id)), bookmark)
    } finally {
      await cleanup()
    }
  })

  it('updates existing bookmark rows', async () => {
    const { path, cleanup } = tempDatabase()
    try {
      const bookmark = bookmarkFixture({ id: 'bookmark-1', title: 'Old title' })
      const updated = {
        ...bookmark,
        title: 'New title',
        status: 'read' as const,
        updatedAt: new Date('2024-01-01T00:01:00.000Z')
      }

      await runStore(path, saveBookmark(bookmark))
      await runStore(path, saveBookmark(updated))

      assert.deepEqual(await runStore(path, findBookmarkById(bookmark.id)), updated)
    } finally {
      await cleanup()
    }
  })

  it('runs domain workflows with sqlite persistence', async () => {
    const { path, cleanup } = tempDatabase()
    try {
      const first = await runDomain(path, addBookmark({
        url: 'https://example.com/read#section',
        tags: ['typescript', 'effects']
      }), {
        metadata: {
          'https://example.com/read': {
            title: 'SQLite-backed bookmarks',
            description: 'Persisted reading queue'
          }
        }
      })
      assertBookmark(first)

      const read = await runDomain(path, markRead(first.id))
      assertBookmark(read)
      assert.equal(read.status, 'read')

      const listed = await runStore(path, listBookmarks({ status: 'read', tag: 'effects', text: 'sqlite' }))
      assert.deepEqual(ids(listed), [first.id])
    } finally {
      await cleanup()
    }
  })
})

type BookmarkFixtureOptions = {
  readonly id?: string
  readonly url?: string
  readonly title?: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly status?: Bookmark['status']
}

type TestOptions = {
  readonly clock?: VirtualClock
  readonly ids?: ReturnType<typeof deterministicBookmarkIds>
  readonly metadata?: Readonly<Record<string, MetadataResult | { readonly title?: string; readonly description?: string }>>
}

const runStore = async <A>(path: string, program: Fx<BookmarkEffects, A>): Promise<A | BookmarkError> =>
  await program.pipe(
    sqliteBookmarkStore(path),
    stubPageMetadata({}),
    deterministicBookmarkIds(['bookmark-1', 'bookmark-2', 'bookmark-3']),
    withClock(new VirtualClock(Date.parse('2024-01-01T00:00:00.000Z'))),
    collect,
    returnAll,
    runPromise
  ).then(result => Array.isArray(result) ? result[0] : result)

const runDomain = async <A>(
  path: string,
  program: Fx<BookmarkEffects | FetchPageMetadata | Time, A>,
  options: TestOptions = {}
): Promise<A | BookmarkError> => {
  const clock = options.clock ?? new VirtualClock(Date.parse('2024-01-01T00:00:00.000Z'))
  const ids = options.ids ?? deterministicBookmarkIds(['bookmark-1', 'bookmark-2', 'bookmark-3'])
  const metadata = options.metadata ?? {}

  return await program.pipe(
    sqliteBookmarkStore(path),
    stubPageMetadata(metadata),
    ids,
    withClock(clock),
    collect,
    returnAll,
    runPromise
  ).then(result => Array.isArray(result) ? result[0] : result)
}

const bookmarkFixture = (options: BookmarkFixtureOptions = {}): Bookmark => ({
  id: options.id ?? 'bookmark-1',
  url: options.url ?? 'https://example.com/read',
  title: options.title ?? 'Example article',
  description: options.description ?? 'An article to read later',
  tags: options.tags ?? ['typescript'],
  status: options.status ?? 'unread',
  metadataStatus: { tag: 'available' },
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z')
})

const tempDatabase = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-bookmarks-sqlite-'))
  return {
    path: join(dir, 'bookmarks.sqlite'),
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

const assertBookmark: (value: Bookmark | BookmarkError | readonly Bookmark[] | undefined) => asserts value is Bookmark =
  (value): asserts value is Bookmark => {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  assert.ok(value !== undefined)
  assert.ok(!Array.isArray(value))
  assert.ok(!('tag' in value))
}

const ids = (bookmarks: Bookmark | BookmarkError | readonly Bookmark[] | undefined): readonly string[] => {
  assert.ok(Array.isArray(bookmarks))
  return bookmarks.map(bookmark => bookmark.id)
}
