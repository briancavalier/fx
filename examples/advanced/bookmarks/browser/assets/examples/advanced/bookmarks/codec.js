import { fail, ok } from '@briancavalier/fx';
import { codecKey, withCodec } from '@briancavalier/fx/codec';
export class InvalidBookmarkJson extends Error {
}
export const BookmarkJson = codecKey()(Symbol('examples/advanced/bookmarks/BookmarkJson'), {
    description: 'Bookmark JSON with Date fields encoded as ISO strings'
});
export const BookmarksJson = codecKey()(Symbol('examples/advanced/bookmarks/BookmarksJson'), {
    description: 'Bookmark array JSON with Date fields encoded as ISO strings'
});
export const AddBookmarkInputJson = codecKey()(Symbol('examples/advanced/bookmarks/AddBookmarkInputJson'), {
    description: 'Add bookmark request JSON'
});
export const withBookmarkCodecs = (program) => program.pipe(withCodec(BookmarkJson, {
    encode: bookmark => ok(bookmarkToWire(bookmark)),
    decode: decodeBookmarkWire
}), withCodec(BookmarksJson, {
    encode: bookmarks => ok(bookmarks.map(bookmarkToWire)),
    decode: decodeBookmarkWireArray
}), withCodec(AddBookmarkInputJson, {
    encode: input => ok(input),
    decode: decodeAddBookmarkInputWire
}));
const decodeBookmarkWireArray = (values) => {
    if (!Array.isArray(values))
        return invalidBookmarkJson('expected bookmark array');
    const bookmarks = [];
    for (const value of values) {
        const bookmark = parseBookmarkWire(value);
        if (bookmark === undefined)
            return invalidBookmarkJson('invalid bookmark JSON');
        bookmarks.push(bookmark);
    }
    return ok(bookmarks);
};
const bookmarkToWire = (bookmark) => ({
    id: bookmark.id,
    url: bookmark.url,
    ...(bookmark.title === undefined ? {} : { title: bookmark.title }),
    ...(bookmark.description === undefined ? {} : { description: bookmark.description }),
    tags: bookmark.tags,
    status: bookmark.status,
    metadataStatus: bookmark.metadataStatus,
    createdAt: bookmark.createdAt.toISOString(),
    updatedAt: bookmark.updatedAt.toISOString()
});
const decodeBookmarkWire = (value) => {
    const bookmark = parseBookmarkWire(value);
    return bookmark === undefined ? invalidBookmarkJson('invalid bookmark JSON') : ok(bookmark);
};
const parseBookmarkWire = (value) => {
    if (!isRecord(value))
        return undefined;
    const createdAt = parseDate(value.createdAt);
    const updatedAt = parseDate(value.updatedAt);
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
        : undefined;
};
const decodeAddBookmarkInputWire = (value) => {
    if (!isRecord(value) || typeof value.url !== 'string')
        return invalidBookmarkJson('invalid add bookmark input JSON');
    if (value.tags === undefined)
        return ok({ url: value.url });
    return isStringArray(value.tags)
        ? ok({ url: value.url, tags: value.tags })
        : invalidBookmarkJson('invalid add bookmark input JSON');
};
const parseDate = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
};
const invalidBookmarkJson = (message) => fail(new InvalidBookmarkJson(message));
const isMetadataStatus = (value) => isRecord(value) &&
    (value.tag === 'not-requested' ||
        value.tag === 'available' ||
        (value.tag === 'failed' && typeof value.reason === 'string'));
const isBookmarkStatus = (value) => value === 'unread' || value === 'read' || value === 'archived';
const isStringArray = (value) => Array.isArray(value) && value.every(item => typeof item === 'string');
const isOptionalString = (value) => value === undefined || typeof value === 'string';
const isRecord = (value) => typeof value === 'object' && value !== null;
