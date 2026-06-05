import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Async, type Fx, returnAll, runCatch, runPromise } from '@briancavalier/fx'

import { collect } from '@briancavalier/fx/log'
import { type Time, VirtualClock, withClock } from '@briancavalier/fx/time'

import {
  addBookmark,
  archiveBookmark,
  deterministicBookmarkIds,
  listBookmarks,
  markRead,
  memoryBookmarkStore,
  refreshMetadata,
  stubPageMetadata,
  type Bookmark,
  type BookmarkEffects,
  type BookmarkError,
  type FetchPageMetadata,
  type MetadataResult
} from './domain.js'

describe('bookmarks example domain', () => {
  it('fails invalid URLs', async () => {
    const result = await runDomain(addBookmark({ url: 'not a url' }))

    assert.deepEqual(result, { tag: 'InvalidUrl', input: 'not a url' })
  })

  it('adds a bookmark with normalized URL, tags, metadata, id, and timestamps', async () => {
    const result = await runDomain(addBookmark({
      url: 'https://example.com/article#section',
      tags: ['typescript', 'effects', 'typescript', '']
    }), {
      metadata: {
        'https://example.com/article': {
          title: 'Effects in TypeScript',
          description: 'A practical article'
        }
      }
    })

    assertBookmark(result)
    assert.equal(result.id, 'bookmark-1')
    assert.equal(result.url, 'https://example.com/article')
    assert.deepEqual(result.tags, ['typescript', 'effects'])
    assert.equal(result.title, 'Effects in TypeScript')
    assert.equal(result.description, 'A practical article')
    assert.deepEqual(result.metadataStatus, { tag: 'available' })
    assert.equal(result.createdAt.toISOString(), '2024-01-01T00:00:00.000Z')
    assert.equal(result.updatedAt.toISOString(), '2024-01-01T00:00:00.000Z')
  })

  it('fails duplicate active URLs with the existing bookmark id', async () => {
    const store = memoryBookmarkStore()
    const ids = deterministicBookmarkIds(['bookmark-1', 'bookmark-2'])
    const first = await runDomain(addBookmark({ url: 'https://example.com/read' }), { store, ids })
    const second = await runDomain(addBookmark({ url: 'https://example.com/read#later' }), { store, ids })

    assertBookmark(first)
    assert.deepEqual(second, {
      tag: 'DuplicateBookmark',
      url: 'https://example.com/read',
      id: first.id
    })
  })

  it('fails duplicate active URLs after re-adding an archived URL', async () => {
    const store = memoryBookmarkStore()
    const ids = deterministicBookmarkIds(['bookmark-1', 'bookmark-2', 'bookmark-3'])
    const archived = await runDomain(addBookmark({ url: 'https://example.com/read' }), { store, ids })
    assertBookmark(archived)

    await runDomain(archiveBookmark(archived.id), { store })
    const active = await runDomain(addBookmark({ url: 'https://example.com/read' }), { store, ids })
    assertBookmark(active)

    assert.deepEqual(await runDomain(addBookmark({ url: 'https://example.com/read' }), { store, ids }), {
      tag: 'DuplicateBookmark',
      url: 'https://example.com/read',
      id: active.id
    })
  })

  it('keeps bookmark creation successful when metadata fetch fails', async () => {
    const result = await runDomain(addBookmark({ url: 'https://example.com/offline' }), {
      metadata: {
        'https://example.com/offline': { tag: 'failed', reason: 'network unavailable' }
      }
    })

    assertBookmark(result)
    assert.deepEqual(result.metadataStatus, { tag: 'failed', reason: 'network unavailable' })
    assert.equal(result.title, undefined)
  })

  it('lists bookmarks by status, tag, and text', async () => {
    const store = memoryBookmarkStore()
    const bookmarkIds = deterministicBookmarkIds(['bookmark-1', 'bookmark-2'])

    const first = await runDomain(addBookmark({ url: 'https://example.com/typescript', tags: ['typescript'] }), { store, ids: bookmarkIds })
    const second = await runDomain(addBookmark({ url: 'https://example.com/effects', tags: ['effects'] }), { store, ids: bookmarkIds })
    assertBookmark(first)
    assertBookmark(second)

    await runDomain(markRead(second.id), { store })

    const unread = await runDomain(listBookmarks({ status: 'unread' }), { store })
    const byTag = await runDomain(listBookmarks({ tag: 'effects' }), { store })
    const byText = await runDomain(listBookmarks({ text: 'typescript' }), { store })

    assert.deepEqual(ids(unread), [first.id])
    assert.deepEqual(ids(byTag), [second.id])
    assert.deepEqual(ids(byText), [first.id])
  })

  it('marks bookmarks read and archives bookmarks with updated timestamps', async () => {
    const clock = new VirtualClock(Date.parse('2024-01-01T00:00:00.000Z'))
    const store = memoryBookmarkStore()
    const ids = deterministicBookmarkIds(['bookmark-1'])

    const bookmark = await runDomain(addBookmark({ url: 'https://example.com/later' }), { clock, store, ids })
    assertBookmark(bookmark)

    await clock.step(1000)
    const read = await runDomain(markRead(bookmark.id), { clock, store })
    assertBookmark(read)
    assert.equal(read.status, 'read')
    assert.equal(read.updatedAt.toISOString(), '2024-01-01T00:00:01.000Z')

    await clock.step(1000)
    const archived = await runDomain(archiveBookmark(bookmark.id), { clock, store })
    assertBookmark(archived)
    assert.equal(archived.status, 'archived')
    assert.equal(archived.updatedAt.toISOString(), '2024-01-01T00:00:02.000Z')
  })

  it('fails missing ids for mark read, archive, and refresh metadata', async () => {
    assert.deepEqual(await runDomain(markRead('missing')), { tag: 'BookmarkNotFound', id: 'missing' })
    assert.deepEqual(await runDomain(archiveBookmark('missing')), { tag: 'BookmarkNotFound', id: 'missing' })
    assert.deepEqual(await runDomain(refreshMetadata('missing')), { tag: 'BookmarkNotFound', id: 'missing' })
  })

  it('refreshes metadata for an existing bookmark', async () => {
    const store = memoryBookmarkStore()
    const ids = deterministicBookmarkIds(['bookmark-1'])
    const bookmark = await runDomain(addBookmark({ url: 'https://example.com/old' }), {
      store,
      ids,
      metadata: { 'https://example.com/old': { title: 'Old title' } }
    })
    assertBookmark(bookmark)

    const refreshed = await runDomain(refreshMetadata(bookmark.id), {
      store,
      ids,
      metadata: { 'https://example.com/old': { title: 'New title', description: 'Updated' } }
    })

    assertBookmark(refreshed)
    assert.equal(refreshed.title, 'New title')
    assert.equal(refreshed.description, 'Updated')
  })

  it('keeps domain effects visible until handlers remove them', () => {
    const program = addBookmark({ url: 'https://example.com/types' })
    // @ts-expect-error the raw domain program still requires bookmark effects
    const unhandled: Fx<never, Bookmark> = program
    void unhandled

    const handled = program.pipe(
      memoryBookmarkStore(),
      stubPageMetadata({}),
      deterministicBookmarkIds(['bookmark-1']),
      withClock(new VirtualClock(0)),
      collect,
      returnAll, runCatch
    )

    const runnable: Fx<Async, readonly [Bookmark, readonly unknown[]] | BookmarkError> = handled
    void runnable
  })
})

type TestOptions = {
  readonly clock?: VirtualClock
  readonly store?: ReturnType<typeof memoryBookmarkStore>
  readonly ids?: ReturnType<typeof deterministicBookmarkIds>
  readonly metadata?: Readonly<Record<string, MetadataResult | { readonly title?: string; readonly description?: string }>>
}

const runDomain = async <A>(
  program: Fx<BookmarkEffects | FetchPageMetadata | Time, A>,
  options: TestOptions = {}
): Promise<A | BookmarkError> => {
  const clock = options.clock ?? new VirtualClock(Date.parse('2024-01-01T00:00:00.000Z'))
  const store = options.store ?? memoryBookmarkStore()
  const ids = options.ids ?? deterministicBookmarkIds(['bookmark-1', 'bookmark-2', 'bookmark-3'])
  const metadata = options.metadata ?? {}

  return await program.pipe(
    store,
    stubPageMetadata(metadata),
    ids,
    withClock(clock),
    collect,
    returnAll, runCatch,
    runPromise
  ).then(result => Array.isArray(result) ? result[0] : result)
}

const assertBookmark: (value: Bookmark | BookmarkError | readonly Bookmark[]) => asserts value is Bookmark =
  (value): asserts value is Bookmark => {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  assert.ok(!Array.isArray(value))
  assert.ok(!('tag' in value))
}

const ids = (value: Bookmark | BookmarkError | readonly Bookmark[]): readonly string[] => {
  assert.ok(Array.isArray(value))
  return value.map(bookmark => bookmark.id)
}
