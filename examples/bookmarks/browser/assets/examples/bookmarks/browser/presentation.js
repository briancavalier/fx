import { Effect } from '../../../src/Effect.js';
import { flatMap } from '../../../src/Fx.js';
import { withCapturedHandlers } from '../../../src/HandlerCapture.js';
export const BusyScope = 'example/Bookmarks/Presentation/Busy';
export class Busy extends Effect('example/Bookmarks/Presentation/Busy') {
}
export class ReadAddBookmarkInput extends Effect('example/Bookmarks/Presentation/ReadAddBookmarkInput') {
}
export class ReadBookmarkQuery extends Effect('example/Bookmarks/Presentation/ReadBookmarkQuery') {
}
export class RenderBookmarks extends Effect('example/Bookmarks/Presentation/RenderBookmarks') {
}
export class ShowMessage extends Effect('example/Bookmarks/Presentation/ShowMessage') {
}
export class ResetAddForm extends Effect('example/Bookmarks/Presentation/ResetAddForm') {
}
export const busy = (program) => withCapturedHandlers(BusyScope, program).pipe(flatMap(fx => new Busy(fx)));
export const readAddBookmarkInput = new ReadAddBookmarkInput();
export const readBookmarkQuery = new ReadBookmarkQuery();
export const renderBookmarks = (bookmarks) => new RenderBookmarks(bookmarks);
export const showOk = (message) => new ShowMessage({ kind: 'ok', message });
export const showError = (message) => new ShowMessage({ kind: 'error', message });
export const resetAddForm = new ResetAddForm();
