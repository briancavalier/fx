import { catchAll, fx, type Fx, map, ok, runCatch, runPromise } from '@briancavalier/fx'

import { w3cFetch } from '@briancavalier/fx/http-client'
import {
  archiveBookmark,
  createBookmark,
  listBookmarks,
  markBookmarkRead,
  refreshBookmarkMetadata,
  type BookmarkClientEffects,
  type BookmarkClientError
} from './client.js'
import type { AddBookmarkInput, Bookmark, BookmarkQuery, BookmarkStatus } from './domain.js'

export const defaultBaseUrl = new URL('http://127.0.0.1:3000/api')

export type CliCommand =
  | { readonly tag: 'add'; readonly input: AddBookmarkInput }
  | { readonly tag: 'list'; readonly query: BookmarkQuery }
  | { readonly tag: 'read'; readonly id: string }
  | { readonly tag: 'archive'; readonly id: string }
  | { readonly tag: 'refresh'; readonly id: string }

export type ParseResult =
  | { readonly tag: 'ok'; readonly command: CliCommand }
  | { readonly tag: 'error'; readonly message: string }

export type CliResult =
  | { readonly tag: 'success'; readonly output: string }
  | { readonly tag: 'failure'; readonly message: string }

export type CliEnv = {
  readonly BOOKMARKS_URL?: string
}

export const parseArgs = (args: readonly string[]): ParseResult => {
  const [command, ...rest] = args

  switch (command) {
    case 'add':
      return parseAdd(rest)

    case 'list':
      return parseList(rest)

    case 'read':
      return parseIdCommand('read', rest)

    case 'archive':
      return parseIdCommand('archive', rest)

    case 'refresh':
      return parseIdCommand('refresh', rest)

    default:
      return { tag: 'error', message: usage() }
  }
}

export const runCli = (
  baseUrl: URL,
  command: CliCommand
): Fx<BookmarkClientEffects, CliResult> =>
  runCommand(baseUrl, command).pipe(
    map(output => ({ tag: 'success', output }) as const),
    catchAll((error: BookmarkClientError) => ok({ tag: 'failure', message: formatClientError(error) } as const)),
    runCatch
  )

export const formatBookmark = (bookmark: Bookmark): string => {
  const title = bookmark.title ?? bookmark.url
  const tags = bookmark.tags.length === 0 ? '' : ` [${bookmark.tags.join(', ')}]`
  return `${bookmark.id} ${bookmark.status} ${title}${tags}`
}

export const formatBookmarkList = (bookmarks: readonly Bookmark[]): string =>
  bookmarks.length === 0
    ? 'No bookmarks'
    : bookmarks.map(formatBookmark).join('\n')

export const formatClientError = (error: BookmarkClientError): string => {
  switch (error.tag) {
    case 'BookmarkRequestFailed':
      return `Request failed: ${formatCause(error.cause)}`

    case 'InvalidBookmarkResponse':
      return 'Invalid bookmark API response'
  }
}

const runCommand = (
  baseUrl: URL,
  command: CliCommand
): Fx<BookmarkClientEffects, string> => fx(function* () {
  switch (command.tag) {
    case 'add': {
      const bookmark = yield* createBookmark(baseUrl, command.input)
      return `Added ${formatBookmark(bookmark)}`
    }

    case 'list':
      return formatBookmarkList(yield* listBookmarks(baseUrl, command.query))

    case 'read':
      return `Read ${formatBookmark(yield* markBookmarkRead(baseUrl, command.id))}`

    case 'archive':
      return `Archived ${formatBookmark(yield* archiveBookmark(baseUrl, command.id))}`

    case 'refresh':
      return `Refreshed ${formatBookmark(yield* refreshBookmarkMetadata(baseUrl, command.id))}`
  }
})

const parseAdd = (args: readonly string[]): ParseResult => {
  const [url, ...rest] = args
  if (url === undefined) return parseError('Usage: bookmarks add <url> [--tag tag]...')

  const tags = parseTags(rest)
  return tags.tag === 'error'
    ? tags
    : { tag: 'ok', command: { tag: 'add', input: { url, tags: tags.values } } }
}

const parseList = (args: readonly string[]): ParseResult => {
  const query: { status?: BookmarkStatus | 'all'; tag?: string; text?: string } = {}

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    const value = args[index + 1]

    switch (option) {
      case '--status':
        if (value === undefined) return parseError('Missing value for --status')
        if (!isListStatus(value)) return parseError('Status must be unread, read, archived, or all')
        query.status = value
        index += 1
        break

      case '--tag':
        if (value === undefined) return parseError('Missing value for --tag')
        query.tag = value
        index += 1
        break

      case '--text':
        if (value === undefined) return parseError('Missing value for --text')
        query.text = value
        index += 1
        break

      default:
        return parseError(`Unknown list option: ${String(option)}`)
    }
  }

  return { tag: 'ok', command: { tag: 'list', query } }
}

const parseIdCommand = (
  command: 'read' | 'archive' | 'refresh',
  args: readonly string[]
): ParseResult => {
  const [id, ...extra] = args
  if (id === undefined) return parseError(`Usage: bookmarks ${command} <id>`)
  if (extra.length > 0) return parseError(`Unexpected argument: ${extra[0]}`)
  return { tag: 'ok', command: { tag: command, id } }
}

const parseTags = (args: readonly string[]): { readonly tag: 'ok'; readonly values: readonly string[] } | { readonly tag: 'error'; readonly message: string } => {
  const tags: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    const value = args[index + 1]

    if (option !== '--tag') return parseError(`Unknown add option: ${String(option)}`)
    if (value === undefined) return parseError('Missing value for --tag')

    tags.push(value)
    index += 1
  }

  return { tag: 'ok', values: tags }
}

const parseError = (message: string): { readonly tag: 'error'; readonly message: string } =>
  ({ tag: 'error', message })

const isListStatus = (value: string): value is BookmarkStatus | 'all' =>
  value === 'unread' || value === 'read' || value === 'archived' || value === 'all'

const formatCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const usage = () => [
  'Usage:',
  '  bookmarks add <url> [--tag tag]...',
  '  bookmarks list [--status unread|read|archived|all] [--tag tag] [--text text]',
  '  bookmarks read <id>',
  '  bookmarks archive <id>',
  '  bookmarks refresh <id>'
].join('\n')

export const main = (args: readonly string[], env: CliEnv): Fx<BookmarkClientEffects, CliResult> => {
  const parsed = parseArgs(args)
  return parsed.tag === 'error'
    ? ok({ tag: 'failure', message: parsed.message })
    : runCli(new URL(env.BOOKMARKS_URL ?? defaultBaseUrl), parsed.command)
}

const runMain = (program: Fx<BookmarkClientEffects, CliResult>): Promise<CliResult> =>
  program.pipe(
    w3cFetch(),
    catchAll(cause => ok({ tag: 'failure', message: `Request failed: ${formatCause(cause)}` } as const)),
    runCatch,
    runPromise
  )

const runtime = globalThis as unknown as {
  readonly process?: {
    readonly argv: readonly string[]
    readonly env: CliEnv
    exitCode?: number
  }
  readonly console?: {
    readonly log: (message: string) => void
    readonly error: (message: string) => void
  }
}

const isMain = (argv: readonly string[], moduleUrl: string): boolean =>
  argv[1] === modulePath(moduleUrl)

const modulePath = (moduleUrl: string): string =>
  decodeURIComponent(new URL(moduleUrl).pathname)

if (runtime.process !== undefined && isMain(runtime.process.argv, import.meta.url)) {
  const result = await runMain(main(runtime.process.argv.slice(2), runtime.process.env))

  if (result.tag === 'success') {
    runtime.console?.log(result.output)
  } else {
    runtime.console?.error(result.message)
    runtime.process.exitCode = 1
  }
}
