import { fail, catchAll } from '../../../src/Fail.js';
import { flatMap, ok } from '../../../src/Fx.js';
import { expectSuccess, json, request } from '../../../src/HttpClient.js';
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
const decodeBookmarks = (value) => Array.isArray(value)
    ? decodeBookmarkArray(value)
    : invalidResponse(value);
const decodeBookmarkArray = (values) => {
    const bookmarks = [];
    for (const value of values) {
        const bookmark = parseBookmark(value);
        if (bookmark === undefined)
            return invalidResponse(value);
        bookmarks.push(bookmark);
    }
    return ok(bookmarks);
};
const decodeBookmark = (value) => {
    const bookmark = parseBookmark(value);
    return bookmark === undefined ? invalidResponse(value) : ok(bookmark);
};
const invalidResponse = (value) => fail({ tag: 'InvalidBookmarkResponse', value });
const parseBookmark = (value) => {
    if (!isRecord(value))
        return undefined;
    const createdAt = parseDate(value.createdAt);
    const updatedAt = parseDate(value.updatedAt);
    return typeof value.id === 'string' &&
        typeof value.url === 'string' &&
        isStringArray(value.tags) &&
        isBookmarkStatus(value.status) &&
        isMetadataStatus(value.metadataStatus) &&
        createdAt !== undefined &&
        updatedAt !== undefined
        ? {
            id: value.id,
            url: value.url,
            title: typeof value.title === 'string' ? value.title : undefined,
            description: typeof value.description === 'string' ? value.description : undefined,
            tags: value.tags,
            status: value.status,
            metadataStatus: value.metadataStatus,
            createdAt,
            updatedAt
        }
        : undefined;
};
const parseDate = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
};
const isMetadataStatus = (value) => isRecord(value) &&
    (value.tag === 'not-requested' ||
        value.tag === 'available' ||
        (value.tag === 'failed' && typeof value.reason === 'string'));
const isBookmarkStatus = (value) => value === 'unread' || value === 'read' || value === 'archived';
const isStringArray = (value) => Array.isArray(value) && value.every(item => typeof item === 'string');
const isRecord = (value) => typeof value === 'object' && value !== null;
