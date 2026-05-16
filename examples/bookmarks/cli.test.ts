import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assert as assertNoFail, returnAll } from '../../src/Fail.js'
import { ok } from '../../src/Fx.js'
import { handle } from '../../src/Handler.js'
import { HttpRequest, type Request, type ResponseBody } from '../../src/HttpClient.js'
import { runPromise } from '../../src/index.js'
import {
  archiveBookmark,
  createBookmark,
  listBookmarks,
  markBookmarkRead,
  refreshBookmarkMetadata
} from './client.js'
import { formatBookmark, formatBookmarkList, parseArgs } from './cli.js'
import type { Bookmark } from './domain.js'

describe('bookmarks CLI', () => {
  it('parses add with repeated tags', () => {
    assert.deepEqual(parseArgs(['add', 'https://example.com', '--tag', 'typescript', '--tag', 'effects']), {
      tag: 'ok',
      command: {
        tag: 'add',
        input: {
          url: 'https://example.com',
          tags: ['typescript', 'effects']
        }
      }
    })
  })

  it('parses list filters', () => {
    assert.deepEqual(parseArgs(['list', '--status', 'unread', '--tag', 'typescript', '--text', 'effects']), {
      tag: 'ok',
      command: {
        tag: 'list',
        query: {
          status: 'unread',
          tag: 'typescript',
          text: 'effects'
        }
      }
    })
  })

  it('parses id commands', () => {
    assert.deepEqual(parseArgs(['read', 'bookmark-1']), {
      tag: 'ok',
      command: { tag: 'read', id: 'bookmark-1' }
    })
    assert.deepEqual(parseArgs(['archive', 'bookmark-1']), {
      tag: 'ok',
      command: { tag: 'archive', id: 'bookmark-1' }
    })
    assert.deepEqual(parseArgs(['refresh', 'bookmark-1']), {
      tag: 'ok',
      command: { tag: 'refresh', id: 'bookmark-1' }
    })
  })

  it('reports invalid arguments', () => {
    assert.equal(parseArgs(['add']).tag, 'error')
    assert.equal(parseArgs(['list', '--status', 'done']).tag, 'error')
    assert.equal(parseArgs(['read']).tag, 'error')
    assert.equal(parseArgs(['read', 'bookmark-1', 'extra']).tag, 'error')
  })

  it('formats bookmarks compactly', () => {
    assert.equal(formatBookmark(bookmark), 'bookmark-1 unread Example [typescript, effects]')
    assert.equal(formatBookmarkList([]), 'No bookmarks')
    assert.equal(formatBookmarkList([bookmark]), 'bookmark-1 unread Example [typescript, effects]')
  })
})

describe('bookmarks API client', () => {
  it('creates bookmarks with POST /bookmarks', async () => {
    const requests: Request[] = []
    const result = await createBookmark(apiBase, {
      url: 'https://example.com',
      tags: ['typescript']
    }).pipe(
      captureRequests(requests, jsonResponse(bookmark)),
      assertNoFail,
      runPromise
    )

    assert.equal(result.id, 'bookmark-1')
    assert.equal(requests[0]?.method, 'POST')
    assert.equal(requests[0]?.url.href, 'http://localhost/api/bookmarks')
    assert.deepEqual(requests[0]?.body, {
      type: 'json',
      value: {
        url: 'https://example.com',
        tags: ['typescript']
      }
    })
  })

  it('lists bookmarks with query params', async () => {
    const requests: Request[] = []
    const result = await listBookmarks(apiBase, {
      status: 'unread',
      tag: 'typescript',
      text: 'effects'
    }).pipe(
      captureRequests(requests, jsonResponse([bookmark])),
      assertNoFail,
      runPromise
    )

    assert.equal(result.length, 1)
    assert.equal(requests[0]?.method, undefined)
    assert.equal(requests[0]?.url.href, 'http://localhost/api/bookmarks?status=unread&tag=typescript&text=effects')
  })

  it('updates bookmarks with expected routes', async () => {
    const requests: Request[] = []

    await markBookmarkRead(apiBase, 'bookmark/1').pipe(captureRequests(requests, jsonResponse(bookmark)), assertNoFail, runPromise)
    await archiveBookmark(apiBase, 'bookmark/1').pipe(captureRequests(requests, jsonResponse(bookmark)), assertNoFail, runPromise)
    await refreshBookmarkMetadata(apiBase, 'bookmark/1').pipe(captureRequests(requests, jsonResponse(bookmark)), assertNoFail, runPromise)

    assert.deepEqual(requests.map(request => [request.method, request.url.pathname]), [
      ['PATCH', '/api/bookmarks/bookmark%2F1/read'],
      ['PATCH', '/api/bookmarks/bookmark%2F1/archive'],
      ['POST', '/api/bookmarks/bookmark%2F1/metadata/refresh']
    ])
  })

  it('turns non-success responses into client errors', async () => {
    const result = await createBookmark(apiBase, {
      url: 'https://example.com'
    }).pipe(
      captureRequests([], jsonResponse({ tag: 'InvalidUrl' }, 400)),
      returnAll,
      runPromise
    )

    assertClientError(result)
    assert.equal(result.tag, 'BookmarkRequestFailed')
    assert.match(String(result.cause), /actual: 400/)
  })
})

const apiBase = new URL('http://localhost/api')

const bookmark: Bookmark = {
  id: 'bookmark-1',
  url: 'https://example.com',
  title: 'Example',
  description: 'Example description',
  tags: ['typescript', 'effects'],
  status: 'unread',
  metadataStatus: { tag: 'available' },
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z')
}

const captureRequests = (requests: Request[], response: { readonly status: number; readonly body: unknown }) =>
  handle(HttpRequest, effect => {
    requests.push(effect.arg)
    return ok({
      status: response.status,
      headers: [],
      body: jsonBody(response.body)
    })
  })

const jsonResponse = (body: unknown, status = 200) => ({ status, body })

const jsonBody = (body: unknown): ResponseBody => {
  const encoded = new TextEncoder().encode(JSON.stringify(body))
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    }
  })
}

const assertClientError: (value: unknown) => asserts value is { readonly tag: 'BookmarkRequestFailed'; readonly cause: unknown } =
  (value): asserts value is { readonly tag: 'BookmarkRequestFailed'; readonly cause: unknown } => {
    assert.equal(typeof value, 'object')
    assert.notEqual(value, null)
    assert.equal((value as { readonly tag?: unknown }).tag, 'BookmarkRequestFailed')
  }
