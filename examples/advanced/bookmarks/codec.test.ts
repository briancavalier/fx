import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assert as assertNoFail, returnAll, run } from '@briancavalier/fx'

import { decode, encode } from '@briancavalier/fx/codec'
import { AddBookmarkInputJson, BookmarkJson, type AddBookmarkInputWire, InvalidBookmarkJson, withBookmarkCodecs } from './codec.js'
import type { Bookmark } from './domain.js'

describe('bookmarks codecs', () => {
  it('encodes bookmark dates as ISO strings for JSON responses', () => {
    const encoded = withBookmarkCodecs(encode(BookmarkJson, bookmark)).pipe(
      assertNoFail,
      run
    )

    assert.equal(encoded.createdAt, '2024-01-01T00:00:00.000Z')
    assert.equal(encoded.updatedAt, '2024-01-02T00:00:00.000Z')
  })

  it('decodes bookmark ISO date strings into Dates', () => {
    const decoded = withBookmarkCodecs(decode(BookmarkJson, {
      ...bookmark,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z'
    })).pipe(
      assertNoFail,
      run
    )

    assert.ok(decoded.createdAt instanceof Date)
    assert.equal(decoded.createdAt.toISOString(), '2024-01-01T00:00:00.000Z')
    assert.ok(decoded.updatedAt instanceof Date)
    assert.equal(decoded.updatedAt.toISOString(), '2024-01-02T00:00:00.000Z')
  })

  it('decodes valid add bookmark input JSON', () => {
    const decoded = withBookmarkCodecs(decode(AddBookmarkInputJson, {
      url: 'https://example.com',
      tags: ['typescript', 'effects']
    })).pipe(
      assertNoFail,
      run
    )

    assert.deepEqual(decoded, {
      url: 'https://example.com',
      tags: ['typescript', 'effects']
    })
  })

  it('rejects invalid add bookmark input tags', () => {
    const decoded = withBookmarkCodecs(decode(AddBookmarkInputJson, {
      url: 'https://example.com',
      tags: [1]
    } as unknown as AddBookmarkInputWire)).pipe(
      returnAll,
      run
    )

    assert.ok(decoded instanceof InvalidBookmarkJson)
  })
})

const bookmark: Bookmark = {
  id: 'bookmark-1',
  url: 'https://example.com',
  title: 'Example',
  description: 'Example description',
  tags: ['typescript', 'effects'],
  status: 'unread',
  metadataStatus: { tag: 'available' },
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z')
}
