import { catchAll, catchOnly, fail, flatMap } from '@briancavalier/fx';
import { decodeOrFail, encodeOrFail } from '@briancavalier/fx/codec';
import { expectSuccess, request, text } from '@briancavalier/fx/http-client';
import { AddBookmarkInputJson, BookmarkJson, BookmarksJson, InvalidBookmarkJson, withBookmarkCodecs } from './codec.js';
export const createBookmark = (baseUrl, input) => createBookmarkRaw(baseUrl, input).pipe(withClientCodecs);
const createBookmarkRaw = (baseUrl, input) => encodeOrFail(AddBookmarkInputJson, input).pipe(flatMap(body => requestText(baseUrl, 'bookmarks', {
    method: 'POST',
    body: { type: 'text', value: body },
    headers: jsonHeaders
})), flatMap(decodeBookmark));
export const listBookmarks = (baseUrl, query = {}) => listBookmarksRaw(baseUrl, query).pipe(withClientCodecs);
const listBookmarksRaw = (baseUrl, query = {}) => requestText(baseUrl, 'bookmarks', {
    query: bookmarkQueryParams(query)
}).pipe(flatMap(decodeBookmarks));
export const markBookmarkRead = (baseUrl, id) => markBookmarkReadRaw(baseUrl, id).pipe(withClientCodecs);
const markBookmarkReadRaw = (baseUrl, id) => requestText(baseUrl, `bookmarks/${encodeURIComponent(id)}/read`, {
    method: 'PATCH'
}).pipe(flatMap(decodeBookmark));
export const archiveBookmark = (baseUrl, id) => archiveBookmarkRaw(baseUrl, id).pipe(withClientCodecs);
const archiveBookmarkRaw = (baseUrl, id) => requestText(baseUrl, `bookmarks/${encodeURIComponent(id)}/archive`, {
    method: 'PATCH'
}).pipe(flatMap(decodeBookmark));
export const refreshBookmarkMetadata = (baseUrl, id) => refreshBookmarkMetadataRaw(baseUrl, id).pipe(withClientCodecs);
const refreshBookmarkMetadataRaw = (baseUrl, id) => requestText(baseUrl, `bookmarks/${encodeURIComponent(id)}/metadata/refresh`, {
    method: 'POST'
}).pipe(flatMap(decodeBookmark));
const requestText = (baseUrl, path, options = {}) => request({
    method: options.method,
    url: apiUrl(baseUrl, path, options.query),
    body: options.body,
    headers: options.headers
}).pipe(flatMap(expectSuccess), flatMap(text), catchAll(cause => fail({ tag: 'BookmarkRequestFailed', cause })));
const apiUrl = (baseUrl, path, query) => {
    const url = new URL(path, baseUrl.href.endsWith('/') ? baseUrl : new URL(`${baseUrl.href}/`));
    if (query !== undefined) {
        for (const [name, value] of query)
            url.searchParams.append(name, value);
    }
    return url;
};
const bookmarkQueryParams = (query) => {
    const params = new URLSearchParams();
    if (query.status !== undefined)
        params.set('status', query.status);
    if (query.tag !== undefined)
        params.set('tag', query.tag);
    if (query.text !== undefined)
        params.set('text', query.text);
    return params;
};
const decodeBookmarks = (value) => decodeOrFail(BookmarksJson, value);
const decodeBookmark = (value) => decodeOrFail(BookmarkJson, value);
const jsonHeaders = [['content-type', 'application/json']];
const withClientCodecs = (program) => program.pipe(withBookmarkCodecs, catchOnly(InvalidBookmarkJson, error => fail({ tag: 'InvalidBookmarkResponse', value: error })));
