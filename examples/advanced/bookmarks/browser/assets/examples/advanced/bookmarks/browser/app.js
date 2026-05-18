import { catchAll } from '../../../../src/Fail.js';
import { fx, runPromise } from '../../../../src/Fx.js';
import { w3cFetch } from '../../../../src/HttpClient.js';
import { archiveBookmark, createBookmark, listBookmarks, markBookmarkRead, refreshBookmarkMetadata } from '../client.js';
import { domPresentation } from './dom-presentation.js';
import { busy, readAddBookmarkInput, readBookmarkQuery, renderBookmarks, resetAddForm, showError, showOk } from './presentation.js';
const baseUrl = new URL('/api/', window.location.href);
const elements = {
    status: byId('status'),
    addForm: byId('add-form'),
    urlInput: byId('url-input'),
    tagsInput: byId('tags-input'),
    addButton: byId('add-button'),
    filterForm: byId('filter-form'),
    statusFilter: byId('status-filter'),
    tagFilter: byId('tag-filter'),
    textFilter: byId('text-filter'),
    filterButton: byId('filter-button'),
    bookmarks: byId('bookmarks')
};
elements.addForm.addEventListener('submit', event => {
    event.preventDefault();
    void runUi(addBookmarkFlow);
});
elements.filterForm.addEventListener('submit', event => {
    event.preventDefault();
    void runUi(loadBookmarksFlow);
});
elements.bookmarks.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement))
        return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    if (id === undefined)
        return;
    switch (action) {
        case 'read':
            void runUi(updateBookmarkFlow(markBookmarkRead(baseUrl, id), 'Bookmark marked read.'));
            break;
        case 'archive':
            void runUi(updateBookmarkFlow(archiveBookmark(baseUrl, id), 'Bookmark archived.'));
            break;
        case 'refresh':
            void runUi(updateBookmarkFlow(refreshBookmarkMetadata(baseUrl, id), 'Metadata refreshed.'));
            break;
    }
});
const addBookmarkFlow = fx(function* () {
    const input = yield* readAddBookmarkInput;
    if (input === undefined) {
        return yield* showError('Enter a bookmark URL.');
    }
    return yield* busy(recoverClientErrors(fx(function* () {
        yield* showOk('Loading...');
        yield* createBookmark(baseUrl, input);
        const bookmarks = yield* listBookmarks(baseUrl, yield* readBookmarkQuery);
        yield* renderBookmarks(bookmarks);
        yield* resetAddForm;
        yield* showOk('Bookmark added.');
    })));
});
const updateBookmarkFlow = (update, successMessage) => busy(recoverClientErrors(fx(function* () {
    yield* showOk('Loading...');
    yield* update;
    const bookmarks = yield* listBookmarks(baseUrl, yield* readBookmarkQuery);
    yield* renderBookmarks(bookmarks);
    yield* showOk(successMessage);
})));
const loadBookmarksFlow = busy(recoverClientErrors(fx(function* () {
    yield* showOk('Loading...');
    const bookmarks = yield* listBookmarks(baseUrl, yield* readBookmarkQuery);
    yield* renderBookmarks(bookmarks);
    yield* showOk('');
})));
const runUi = async (program) => {
    await program.pipe(w3cFetch(), catchAll(cause => showError(`Request failed: ${formatCause(cause)}`)), domPresentation(elements), runPromise);
};
function recoverClientErrors(program) {
    return program.pipe(catchAll((error) => showError(formatClientError(error))));
}
const formatClientError = (error) => {
    switch (error.tag) {
        case 'BookmarkRequestFailed':
            return `Request failed: ${formatCause(error.cause)}`;
        case 'InvalidBookmarkResponse':
            return 'Invalid bookmark API response.';
    }
};
const formatCause = (cause) => cause instanceof Error ? cause.message : String(cause);
function byId(id) {
    const element = document.getElementById(id);
    if (element === null)
        throw new Error(`Missing element #${id}`);
    return element;
}
void runUi(loadBookmarksFlow);
