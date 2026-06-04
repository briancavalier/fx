import { assertSync, finalizing, fx, ok, type Fx } from '../../../../src/Fx.js'
import { handle } from '../../../../src/Handler.js'
import { handleCaptured } from '../../../../src/HandlerCapture.js'
import type { Interrupt } from '../../../../src/Interrupt.js'
import type { AddBookmarkInput, Bookmark, BookmarkQuery, BookmarkStatus } from '../domain.js'
import {
  Busy,
  BusyScope,
  ReadAddBookmarkInput,
  ReadBookmarkQuery,
  RenderBookmarks,
  ResetAddForm,
  ShowMessage,
  type Presentation
} from './presentation.js'

export type BookmarkElements = {
  readonly status: HTMLOutputElement
  readonly urlInput: HTMLInputElement
  readonly tagsInput: HTMLInputElement
  readonly addButton: HTMLButtonElement
  readonly statusFilter: HTMLSelectElement
  readonly tagFilter: HTMLInputElement
  readonly textFilter: HTMLInputElement
  readonly filterButton: HTMLButtonElement
  readonly bookmarks: HTMLDivElement
}

export const domPresentation = (elements: BookmarkElements) => {
  let busy = false

  const setBusy = (value: boolean) => {
    busy = value
    elements.addButton.disabled = busy
    elements.filterButton.disabled = busy
    for (const button of elements.bookmarks.querySelectorAll('button')) {
      button.disabled = busy
    }
  }

  const interpret = <E, A>(program: Fx<E, A>): Fx<Exclude<E, Presentation> | Interrupt, A> => program.pipe(
      handleCaptured(BusyScope, Busy, effect =>
        fx(function* () {
          yield* assertSync(() => setBusy(true))
          return yield* interpret(effect.arg).pipe(
            finalizing(assertSync(() => setBusy(false)))
          )
        })
      ),
      handle(ReadAddBookmarkInput, () => ok(addBookmarkInput(elements))),
      handle(ReadBookmarkQuery, () => ok(currentQuery(elements))),
      handle(RenderBookmarks, effect => {
        renderBookmarks(elements.bookmarks, effect.arg, busy)
        return ok(undefined)
      }),
      handle(ShowMessage, effect => {
        showStatus(elements.status, effect.arg.message, effect.arg.kind)
        return ok(undefined)
      }),
      handle(ResetAddForm, () => {
        elements.urlInput.value = ''
        elements.tagsInput.value = ''
        elements.urlInput.focus()
        return ok(undefined)
      })
    ) as Fx<Exclude<E, Presentation> | Interrupt, A>

  return interpret
}

const addBookmarkInput = (elements: BookmarkElements): AddBookmarkInput | undefined => {
  const url = elements.urlInput.value.trim()
  if (url === '') return undefined

  return {
    url,
    tags: parseTags(elements.tagsInput.value)
  }
}

const currentQuery = (elements: BookmarkElements): BookmarkQuery => ({
  status: elements.statusFilter.value as BookmarkStatus | 'all',
  tag: valueOrUndefined(elements.tagFilter.value),
  text: valueOrUndefined(elements.textFilter.value)
})

const parseTags = (input: string): readonly string[] =>
  input.split(/[,\s]+/).map(tag => tag.trim()).filter(tag => tag !== '')

const valueOrUndefined = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const renderBookmarks = (
  container: HTMLDivElement,
  bookmarks: readonly Bookmark[],
  busy: boolean
) => {
  container.replaceChildren()

  if (bookmarks.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'No bookmarks match the current filters.'
    container.append(empty)
    return
  }

  for (const bookmark of bookmarks) {
    container.append(renderBookmark(bookmark, busy))
  }
}

const renderBookmark = (bookmark: Bookmark, busy: boolean): HTMLElement => {
  const article = document.createElement('article')
  article.className = 'bookmark'

  const content = document.createElement('div')

  const title = document.createElement('h3')
  const link = document.createElement('a')
  link.href = bookmark.url
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = bookmark.title ?? bookmark.url
  title.append(link)
  content.append(title)

  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `${bookmark.status} · updated ${formatDate(bookmark.updatedAt)}`
  content.append(meta)

  if (bookmark.description !== undefined) {
    const description = document.createElement('div')
    description.className = 'description'
    description.textContent = bookmark.description
    content.append(description)
  }

  if (bookmark.metadataStatus.tag === 'failed') {
    const failure = document.createElement('div')
    failure.className = 'failure'
    failure.textContent = `Metadata unavailable: ${bookmark.metadataStatus.reason}`
    content.append(failure)
  }

  if (bookmark.tags.length > 0) {
    const tags = document.createElement('div')
    tags.className = 'tags'
    for (const tag of bookmark.tags) {
      const tagElement = document.createElement('span')
      tagElement.className = 'tag'
      tagElement.textContent = tag
      tags.append(tagElement)
    }
    content.append(tags)
  }

  article.append(content, renderActions(bookmark, busy))
  return article
}

const renderActions = (bookmark: Bookmark, busy: boolean): HTMLElement => {
  const actions = document.createElement('div')
  actions.className = 'actions'

  if (bookmark.status === 'unread') {
    actions.append(actionButton('Read', 'read', bookmark.id, busy))
  }

  if (bookmark.status !== 'archived') {
    actions.append(actionButton('Archive', 'archive', bookmark.id, busy))
  }

  actions.append(actionButton('Refresh', 'refresh', bookmark.id, busy))
  return actions
}

const actionButton = (label: string, action: string, id: string, busy: boolean): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.dataset.action = action
  button.dataset.id = id
  button.disabled = busy
  return button
}

const showStatus = (status: HTMLOutputElement, message: string, kind: 'ok' | 'error') => {
  status.textContent = message
  status.dataset.kind = kind
}

const formatDate = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
