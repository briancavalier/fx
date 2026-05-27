import { ok } from '@briancavalier/fx';
import { codecFail, codecKey, codecOk, withCodec } from '@briancavalier/fx/codec';
export class InvalidBookmarkJson extends Error {
}
export const BookmarkJson = codecKey()('examples/advanced/bookmarks/BookmarkJson', {
    description: 'Bookmark JSON with Date fields encoded as ISO strings'
});
export const BookmarksJson = codecKey()('examples/advanced/bookmarks/BookmarksJson', {
    description: 'Bookmark array JSON with Date fields encoded as ISO strings'
});
export const AddBookmarkInputJson = codecKey()('examples/advanced/bookmarks/AddBookmarkInputJson', {
    description: 'Add bookmark request JSON'
});
// This example uses a small hand-rolled JSON codec so the data boundary is easy
// to inspect without adding dependencies. A real application could keep the same
// codec keys and delegate these handlers to Zod, Valibot, Arktype, Effect
// Schema, a Standard Schema adapter, or a project-local parser/serializer.
export const withBookmarkCodecs = (program) => program.pipe(withCodec(BookmarkJson, {
    encode: bookmark => ok(encodeJson(bookmarkToWire(bookmark))),
    decode: text => ok(flatMapCodecResult(parseJson(text), decodeBookmarkWire))
}), withCodec(BookmarksJson, {
    encode: bookmarks => ok(encodeJson(bookmarks.map(bookmarkToWire))),
    decode: text => ok(flatMapCodecResult(parseJson(text), decodeBookmarkWireArray))
}), withCodec(AddBookmarkInputJson, {
    encode: input => ok(encodeJson(input)),
    decode: text => ok(flatMapCodecResult(parseJson(text), decodeAddBookmarkInputWire))
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
    return codecOk(bookmarks);
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
    return bookmark === undefined ? invalidBookmarkJson('invalid bookmark JSON') : codecOk(bookmark);
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
        return codecOk({ url: value.url });
    return isStringArray(value.tags)
        ? codecOk({ url: value.url, tags: value.tags })
        : invalidBookmarkJson('invalid add bookmark input JSON');
};
const parseDate = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
};
const invalidBookmarkJson = (message) => codecFail(new InvalidBookmarkJson(message));
const encodeJson = (value) => {
    try {
        return codecOk(JSON.stringify(value));
    }
    catch {
        return invalidBookmarkJson('invalid bookmark JSON');
    }
};
const parseJson = (text) => {
    try {
        return codecOk(JSON.parse(text));
    }
    catch {
        return invalidBookmarkJson('invalid bookmark JSON');
    }
};
const flatMapCodecResult = (result, f) => result.tag === 'ok' ? f(result.value) : result;
const isMetadataStatus = (value) => isRecord(value) &&
    (value.tag === 'not-requested' ||
        value.tag === 'available' ||
        (value.tag === 'failed' && typeof value.reason === 'string'));
const isBookmarkStatus = (value) => value === 'unread' || value === 'read' || value === 'archived';
const isStringArray = (value) => Array.isArray(value) && value.every(item => typeof item === 'string');
const isOptionalString = (value) => value === undefined || typeof value === 'string';
const isRecord = (value) => typeof value === 'object' && value !== null;
