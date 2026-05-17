import { catchAll } from '../../../src/Fail.js'
import { fx, runPromise, type Fx } from '../../../src/Fx.js'
import { w3cFetch } from '../../../src/HttpClient.js'
import type { HandlerCapture } from '../../../src/HandlerCapture.js'
import type { Interrupt } from '../../../src/Interrupt.js'
import {
  archiveBookmark,
  createBookmark,
  listBookmarks,
  markBookmarkRead,
  refreshBookmarkMetadata,
  type BookmarkClientEffects,
  type BookmarkClientError
} from '../client.js'
import type { Bookmark } from '../domain.js'
import { domPresentation } from './dom-presentation.js'
import {
  busy,
  readAddBookmarkInput,
  readBookmarkQuery,
  renderBookmarks,
  resetAddForm,
  showError,
  showOk,
  BusyScope,
  type Presentation
} from './presentation.js'

const baseUrl = new URL('/api/', window.location.href)

type UiEffects = BookmarkClientEffects | Presentation | HandlerCapture<typeof BusyScope> | Interrupt

const elements = {
  status: byId<HTMLOutputElement>('status'),
  addForm: byId<HTMLFormElement>('add-form'),
  urlInput: byId<HTMLInputElement>('url-input'),
  tagsInput: byId<HTMLInputElement>('tags-input'),
  addButton: byId<HTMLButtonElement>('add-button'),
  filterForm: byId<HTMLFormElement>('filter-form'),
  statusFilter: byId<HTMLSelectElement>('status-filter'),
  tagFilter: byId<HTMLInputElement>('tag-filter'),
  textFilter: byId<HTMLInputElement>('text-filter'),
  filterButton: byId<HTMLButtonElement>('filter-button'),
  bookmarks: byId<HTMLDivElement>('bookmarks')
}

elements.addForm.addEventListener('submit', event => {
  event.preventDefault()
  void runUi(addBookmarkFlow)
})

elements.filterForm.addEventListener('submit', event => {
  event.preventDefault()
  void runUi(loadBookmarksFlow)
})

elements.bookmarks.addEventListener('click', event => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) return

  const action = target.dataset.action
  const id = target.dataset.id
  if (id === undefined) return

  switch (action) {
    case 'read':
      void runUi(updateBookmarkFlow(markBookmarkRead(baseUrl, id), 'Bookmark marked read.'))
      break

    case 'archive':
      void runUi(updateBookmarkFlow(archiveBookmark(baseUrl, id), 'Bookmark archived.'))
      break

    case 'refresh':
      void runUi(updateBookmarkFlow(refreshBookmarkMetadata(baseUrl, id), 'Metadata refreshed.'))
      break
  }
})

const addBookmarkFlow = fx(function* () {
  const input = yield* readAddBookmarkInput
  if (input === undefined) {
    return yield* showError('Enter a bookmark URL.')
  }

  return yield* busy(recoverClientErrors(fx(function* () {
    yield* showOk('Loading...')
    yield* createBookmark(baseUrl, input)
    const bookmarks = yield* listBookmarks(baseUrl, yield* readBookmarkQuery)
    yield* renderBookmarks(bookmarks)
    yield* resetAddForm
    yield* showOk('Bookmark added.')
  })))
})

const updateBookmarkFlow = (
  update: Fx<BookmarkClientEffects, Bookmark>,
  successMessage: string
): Fx<UiEffects, void> =>
  busy(recoverClientErrors(fx(function* () {
    yield* showOk('Loading...')
    yield* update
    const bookmarks = yield* listBookmarks(baseUrl, yield* readBookmarkQuery)
    yield* renderBookmarks(bookmarks)
    yield* showOk(successMessage)
  })))

const loadBookmarksFlow: Fx<UiEffects, void> =
  busy(recoverClientErrors(fx(function* () {
    yield* showOk('Loading...')
    const bookmarks = yield* listBookmarks(baseUrl, yield* readBookmarkQuery)
    yield* renderBookmarks(bookmarks)
    yield* showOk('')
  })))

const runUi = async (program: Fx<UiEffects, void>): Promise<void> => {
  await program.pipe(
    w3cFetch(),
    catchAll(cause => showError(`Request failed: ${formatCause(cause)}`)),
    domPresentation(elements),
    runPromise
  )
}

function recoverClientErrors<E, A>(
  program: Fx<E | BookmarkClientEffects, A>
): Fx<E | BookmarkClientEffects | Presentation, A | void> {
  return program.pipe(
    catchAll((error: BookmarkClientError) => showError(formatClientError(error)))
  )
}

const formatClientError = (error: BookmarkClientError): string => {
  switch (error.tag) {
    case 'BookmarkRequestFailed':
      return `Request failed: ${formatCause(error.cause)}`

    case 'InvalidBookmarkResponse':
      return 'Invalid bookmark API response.'
  }
}

const formatCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`Missing element #${id}`)
  return element as T
}

void runUi(loadBookmarksFlow)
