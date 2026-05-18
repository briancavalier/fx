import { fail } from '../../../src/Fail.js';
import { fx, map, ok } from '../../../src/Fx.js';
import { handle } from '../../../src/Handler.js';
import { info } from '../../../src/Log.js';
import { int } from '../../../src/Random.js';
import { now } from '../../../src/Time.js';
import { Effect } from '../../../src/index.js';
/**
 * Request bookmark persistence without choosing a storage backend.
 */
export class FindBookmarkById extends Effect('example/Bookmarks/FindBookmarkById') {
}
export class FindBookmarkByUrl extends Effect('example/Bookmarks/FindBookmarkByUrl') {
}
export class ListBookmarks extends Effect('example/Bookmarks/ListBookmarks') {
}
export class SaveBookmark extends Effect('example/Bookmarks/SaveBookmark') {
}
/**
 * Request page metadata for a bookmark URL.
 */
export class FetchPageMetadata extends Effect('example/Bookmarks/FetchPageMetadata') {
}
/**
 * Request a new bookmark id.
 */
export class NextBookmarkId extends Effect('example/Bookmarks/NextBookmarkId') {
}
export const findBookmarkById = (id) => new FindBookmarkById(id);
export const findBookmarkByUrl = (url) => new FindBookmarkByUrl(url);
export const listStoredBookmarks = (query = {}) => new ListBookmarks(query);
export const saveBookmark = (bookmark) => new SaveBookmark(bookmark);
export const fetchPageMetadata = (url) => new FetchPageMetadata(url);
export const nextBookmarkId = new NextBookmarkId();
export const addBookmark = (input) => fx(function* () {
    const url = yield* normalizeUrl(input.url);
    const existing = yield* findBookmarkByUrl(url);
    if (existing !== undefined && existing.status !== 'archived') {
        return yield* fail({ tag: 'DuplicateBookmark', url, id: existing.id });
    }
    const id = yield* nextBookmarkId;
    const timestamp = new Date(yield* now);
    const metadata = yield* fetchPageMetadata(url);
    const bookmark = yield* saveBookmark({
        ...pageMetadataFields(metadata),
        id,
        url,
        tags: normalizeTags(input.tags ?? []),
        status: 'unread',
        metadataStatus: metadataStatus(metadata),
        createdAt: timestamp,
        updatedAt: timestamp
    });
    yield* info('Bookmark added', { id, url });
    return bookmark;
});
export const listBookmarks = (query = {}) => listStoredBookmarks(normalizeQuery(query));
export const markRead = (id) => updateBookmark(id, bookmark => ok({
    ...bookmark,
    status: 'read'
}), 'Bookmark marked read');
export const archiveBookmark = (id) => updateBookmark(id, bookmark => ok({
    ...bookmark,
    status: 'archived'
}), 'Bookmark archived');
export const refreshMetadata = (id) => updateBookmark(id, bookmark => fx(function* () {
    const metadata = yield* fetchPageMetadata(bookmark.url);
    return {
        ...bookmark,
        ...pageMetadataFields(metadata),
        metadataStatus: metadataStatus(metadata)
    };
}), 'Bookmark metadata refreshed');
const updateBookmark = (id, update, message) => fx(function* () {
    const bookmark = yield* findBookmarkById(id);
    if (bookmark === undefined) {
        return yield* fail({ tag: 'BookmarkNotFound', id });
    }
    const updated = yield* update(bookmark);
    const timestamped = yield* saveBookmark({
        ...updated,
        updatedAt: new Date(yield* now)
    });
    yield* info(message, { id });
    return timestamped;
});
export const memoryBookmarkStore = (initial = []) => {
    const bookmarks = new Map();
    for (const bookmark of initial)
        bookmarks.set(bookmark.id, bookmark);
    const handleBookmarkStore = (program) => program.pipe(handle(FindBookmarkById, effect => ok(bookmarks.get(effect.arg))), handle(FindBookmarkByUrl, effect => ok(findByUrl(bookmarks, effect.arg))), handle(ListBookmarks, effect => ok(filterBookmarks(bookmarks, effect.arg))), handle(SaveBookmark, effect => {
        bookmarks.set(effect.arg.id, effect.arg);
        return ok(effect.arg);
    }));
    return handleBookmarkStore;
};
export const stubPageMetadata = (metadata) => handle(FetchPageMetadata, effect => {
    const result = metadata[effect.arg];
    return ok(result === undefined
        ? { tag: 'failed', reason: 'No stub metadata configured' }
        : isMetadataResult(result)
            ? result
            : { tag: 'available', metadata: result });
});
export const demoPageMetadata = handle(FetchPageMetadata, effect => {
    const url = new URL(effect.arg);
    const path = url.pathname === '/' ? '' : url.pathname;
    return ok({
        tag: 'available',
        metadata: {
            title: `${url.hostname}${path}`,
            description: `Saved from ${url.origin}`
        }
    });
});
export const deterministicBookmarkIds = (ids) => {
    let index = 0;
    const handleBookmarkIds = handle(NextBookmarkId, () => {
        const id = ids[index] ?? `bookmark-${index + 1}`;
        index += 1;
        return ok(id);
    });
    return handleBookmarkIds;
};
export const randomBookmarkIds = handle(NextBookmarkId, () => int().pipe(map(id => `bookmark-${id.toString(16).padStart(8, '0')}`)));
const normalizeUrl = (input) => {
    try {
        const url = new URL(input);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return fail({ tag: 'InvalidUrl', input });
        }
        url.hash = '';
        return ok(url.href);
    }
    catch {
        return fail({ tag: 'InvalidUrl', input });
    }
};
const normalizeTags = (tags) => {
    const seen = new Set();
    const normalized = [];
    for (const tag of tags) {
        const value = tag.trim();
        if (value === '' || seen.has(value))
            continue;
        seen.add(value);
        normalized.push(value);
    }
    return normalized;
};
const normalizeQuery = (query) => ({
    ...query,
    tag: query.tag?.trim() || undefined,
    text: query.text?.trim() || undefined
});
const metadataStatus = (result) => result.tag === 'available'
    ? { tag: 'available' }
    : { tag: 'failed', reason: result.reason };
const pageMetadataFields = (result) => result.tag === 'available'
    ? result.metadata
    : {};
const findByUrl = (bookmarks, url) => [...bookmarks.values()].find(bookmark => bookmark.url === url);
const filterBookmarks = (bookmarks, query) => {
    const normalized = normalizeQuery(query);
    const tag = normalized.tag;
    const text = normalized.text?.toLocaleLowerCase();
    return [...bookmarks.values()]
        .filter(bookmark => normalized.status === undefined || normalized.status === 'all' || bookmark.status === normalized.status)
        .filter(bookmark => tag === undefined || bookmark.tags.includes(tag))
        .filter(bookmark => text === undefined || bookmarkMatchesText(bookmark, text))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
};
const bookmarkMatchesText = (bookmark, text) => bookmark.url.toLocaleLowerCase().includes(text) ||
    bookmark.title?.toLocaleLowerCase().includes(text) === true ||
    bookmark.description?.toLocaleLowerCase().includes(text) === true;
const isMetadataResult = (value) => 'tag' in value && (value.tag === 'available' || value.tag === 'failed');
