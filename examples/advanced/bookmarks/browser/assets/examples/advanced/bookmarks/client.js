import { catchAll, fail, flatMap } from '@briancavalier/fx';
import { decode } from '@briancavalier/fx/codec';
import { expectSuccess, json, request } from '@briancavalier/fx/http-client';
import { BookmarkJson, BookmarksJson, withBookmarkCodecs } from './codec.js';
export const createBookmark = (baseUrl, input) => requestJson(baseUrl, 'bookmarks', {
    method: 'POST',
    body: { type: 'json', value: input }
}).pipe(flatMap(decodeBookmark));
export const listBookmarks = (baseUrl, query = {}) => requestJson(baseUrl, 'bookmarks', {
    query: bookmarkQueryParams(query)
}).pipe(flatMap(decodeBookmarks));
export const markBookmarkRead = (baseUrl, id) => requestJson(baseUrl, `bookmarks/${encodeURIComponent(id)}/read`, {
    method: 'PATCH'
}).pipe(flatMap(decodeBookmark));
export const archiveBookmark = (baseUrl, id) => requestJson(baseUrl, `bookmarks/${encodeURIComponent(id)}/archive`, {
    method: 'PATCH'
}).pipe(flatMap(decodeBookmark));
export const refreshBookmarkMetadata = (baseUrl, id) => requestJson(baseUrl, `bookmarks/${encodeURIComponent(id)}/metadata/refresh`, {
    method: 'POST'
}).pipe(flatMap(decodeBookmark));
const requestJson = (baseUrl, path, options = {}) => request({
    method: options.method,
    url: apiUrl(baseUrl, path, options.query),
    body: options.body
}).pipe(flatMap(expectSuccess), flatMap(json), catchAll(cause => fail({ tag: 'BookmarkRequestFailed', cause })));
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
const decodeBookmarks = (value) => withBookmarkCodecs(decode(BookmarksJson, value)).pipe(catchAll(() => invalidResponse(value)));
const decodeBookmark = (value) => withBookmarkCodecs(decode(BookmarkJson, value)).pipe(catchAll(() => invalidResponse(value)));
const invalidResponse = (value) => fail({ tag: 'InvalidBookmarkResponse', value });
