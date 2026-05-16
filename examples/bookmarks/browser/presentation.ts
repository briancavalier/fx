import { Effect } from '../../../src/Effect.js'
import { flatMap, type Fx } from '../../../src/Fx.js'
import { HandlerCapture, withCapturedHandlers } from '../../../src/HandlerCapture.js'
import type { AddBookmarkInput, Bookmark, BookmarkQuery } from '../domain.js'

export type Presentation =
  | Busy<any>
  | ReadAddBookmarkInput
  | ReadBookmarkQuery
  | RenderBookmarks
  | ShowMessage
  | ResetAddForm

export type MessageKind = 'ok' | 'error'

export const BusyScope = 'example/Bookmarks/Presentation/Busy'

export class Busy<A> extends Effect('example/Bookmarks/Presentation/Busy')<Fx<unknown, A>, A> { }
export class ReadAddBookmarkInput extends Effect('example/Bookmarks/Presentation/ReadAddBookmarkInput')<void, AddBookmarkInput | undefined> { }
export class ReadBookmarkQuery extends Effect('example/Bookmarks/Presentation/ReadBookmarkQuery')<void, BookmarkQuery> { }
export class RenderBookmarks extends Effect('example/Bookmarks/Presentation/RenderBookmarks')<readonly Bookmark[], void> { }
export class ShowMessage extends Effect('example/Bookmarks/Presentation/ShowMessage')<{ readonly kind: MessageKind; readonly message: string }, void> { }
export class ResetAddForm extends Effect('example/Bookmarks/Presentation/ResetAddForm')<void, void> { }

export const busy = <E, A>(program: Fx<E, A>): Fx<Busy<A> | HandlerCapture<typeof BusyScope>, A> =>
  withCapturedHandlers(BusyScope, program).pipe(
    flatMap(fx => new Busy(fx) as Fx<Busy<A>, A>)
  )
export const readAddBookmarkInput = new ReadAddBookmarkInput()
export const readBookmarkQuery = new ReadBookmarkQuery()
export const renderBookmarks = (bookmarks: readonly Bookmark[]) => new RenderBookmarks(bookmarks)
export const showOk = (message: string) => new ShowMessage({ kind: 'ok', message })
export const showError = (message: string) => new ShowMessage({ kind: 'error', message })
export const resetAddForm = new ResetAddForm()
