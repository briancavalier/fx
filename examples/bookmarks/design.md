# Bookmark Reading Queue Example Design

## Goal

Build a slightly larger `fx` example that shows how an application can keep
domain behavior separate from platform interpretation.

The app is a small bookmark and reading queue service:

- a browser or CLI client adds URLs to a reading queue,
- the API stores bookmarks and optionally enriches them with page metadata,
- users can list, tag, search, archive, and mark items as read,
- tests can run the same domain programs with pure in-memory handlers.

The example should be practical enough to feel like a real application while
remaining small enough to read in one sitting.

## Design Principles

- Domain programs describe what the app needs: store bookmarks, fetch metadata,
  get the current time, generate ids, and log notable events.
- Handlers describe how those requests are interpreted: in-memory storage,
  file-backed storage, real HTTP fetch, stub metadata, API server routes, or CLI
  commands.
- Validation and recoverable errors use `Fail`, not thrown exceptions.
- HTTP, CLI, and browser code stay at the boundary. They convert requests into
  domain inputs and interpret domain outputs into responses.
- The first version should use the smallest public surface that demonstrates the
  pattern. Add concurrency, streaming, or richer persistence only after the core
  example is clear.

## User Workflows

### Add a bookmark

Input:

```json
{
  "url": "https://example.com/article",
  "tags": ["typescript", "effects"]
}
```

Behavior:

1. Validate and normalize the URL.
2. Reject duplicates unless the existing bookmark is archived.
3. Create a bookmark with an id, timestamp, unread status, and initial tags.
4. Try to fetch page metadata.
5. Store the bookmark.
6. Return the created bookmark.

Metadata fetch failures should not fail the add operation. They should produce a
bookmark with a `metadataStatus` that makes the recoverable failure visible.

### List bookmarks

Supported filters:

- status: unread, read, archived, or all
- tag
- search text

The domain should express filtering as a plain query value. Storage handlers can
choose whether filtering happens in memory or in a database.

### Mark as read

Behavior:

1. Load the bookmark by id.
2. Fail with `BookmarkNotFound` if it does not exist.
3. Update status and `updatedAt`.
4. Store the update.

### Archive

Behavior:

1. Load the bookmark by id.
2. Fail with `BookmarkNotFound` if it does not exist.
3. Mark it archived and update `updatedAt`.
4. Store the update.

### Refresh metadata

Behavior:

1. Load the bookmark by id.
2. Fetch page metadata again.
3. Store either the updated metadata or the recoverable metadata error state.

This gives the example a second use of metadata fetching, which helps justify a
named effect without creating broad infrastructure.

## Domain Model

```ts
export type BookmarkId = string

export type BookmarkStatus =
  | 'unread'
  | 'read'
  | 'archived'

export interface Bookmark {
  id: BookmarkId
  url: string
  title?: string
  description?: string
  tags: readonly string[]
  status: BookmarkStatus
  metadataStatus: MetadataStatus
  createdAt: Date
  updatedAt: Date
}

export type MetadataStatus =
  | { readonly tag: 'not-requested' }
  | { readonly tag: 'available' }
  | { readonly tag: 'failed'; readonly reason: string }

export interface PageMetadata {
  title?: string
  description?: string
}

export interface BookmarkQuery {
  status?: BookmarkStatus | 'all'
  tag?: string
  text?: string
}
```

Keep the domain model boring. The interesting part is how effects make the
application boundaries explicit.

## Domain Effects

The example should define app-specific effects directly, rather than wrapping
them in a service object.

### `BookmarkStore`

Represents durable bookmark storage requests.

Requests:

- `findById(id)`
- `findByUrl(url)`
- `list(query)`
- `save(bookmark)`

The store effect should not know whether data is in memory, a JSON file, SQLite,
or another backend.

### `PageMetadata`

Represents fetching metadata for a URL.

Request:

- `fetchMetadata(url)`

The real handler can use `HttpClient` or `Async` plus platform `fetch`. A test
handler can return deterministic metadata or controlled failures.

### Library Effects

Use existing library effects where they add clarity:

- `Time` for timestamps,
- `Random` or a tiny local id effect for id generation,
- `Log` or `Console` for observable events,
- `Fail` for validation, missing bookmark, and invalid state errors,
- `Async` at runtime boundaries.

An explicit local `BookmarkIdGenerator` effect may be worth adding if the
existing random effect would obscure the example. The decision should favor
readability.

## Domain Programs

The domain module should export use-case programs rather than route handlers.

```ts
export const addBookmark = (input: AddBookmarkInput): Fx<
  | BookmarkStore
  | PageMetadata
  | Time
  | Random
  | Log
  | Fail<AddBookmarkError>,
  Bookmark
> => fx(function* () {
  // validate URL
  // check duplicate
  // create bookmark
  // fetch metadata recoverably
  // save
  // return bookmark
})
```

Other domain programs:

- `listBookmarks(query)`
- `markRead(id)`
- `archiveBookmark(id)`
- `refreshMetadata(id)`

These programs should not mention HTTP status codes, request bodies, command-line
arguments, files, process environment, or browser details.

## Failure Model

Recoverable domain failures:

```ts
export type BookmarkError =
  | { readonly tag: 'InvalidUrl'; readonly input: string }
  | { readonly tag: 'DuplicateBookmark'; readonly url: string; readonly id: BookmarkId }
  | { readonly tag: 'BookmarkNotFound'; readonly id: BookmarkId }
```

Metadata fetch failures should usually be captured on the bookmark rather than
returned as `Fail`, because adding a URL is still useful when metadata is
unavailable.

Hard platform defects, programmer mistakes, and invariant violations may still
throw, but the example should avoid needing them.

## Interpreters

### In-memory Store

Use a local `Map` owned by the handler.

Purpose:

- easiest handler to read,
- useful for tests,
- useful for a demo server with ephemeral data.

### JSON File Store

Optional second storage handler.

Purpose:

- demonstrates swapping interpretation without changing domain programs,
- gives CLI usage persistence without introducing a database dependency.

This should be added only if the in-memory version is already clear.

### Real Metadata Handler

Fetch the page HTML and extract:

- `<title>`
- `<meta name="description">`
- `<meta property="og:title">`
- `<meta property="og:description">`

Keep parsing intentionally small. This is an application example, not an HTML
parser example. If real parsing becomes distracting, use a small dependency or
limit metadata extraction to `<title>`.

### Stub Metadata Handler

Return deterministic metadata from a map or function.

Purpose:

- focused tests,
- demo mode without network,
- examples of alternate interpretation.

## API Server

The HTTP server should be thin:

- parse path, method, and JSON body,
- call the relevant domain program,
- apply handlers,
- map success and `Fail` values to HTTP responses.

Suggested routes:

- `POST /bookmarks`
- `GET /bookmarks`
- `PATCH /bookmarks/:id/read`
- `PATCH /bookmarks/:id/archive`
- `POST /bookmarks/:id/metadata/refresh`

The route layer owns HTTP concerns:

- request parsing,
- response encoding,
- status code mapping,
- server startup and shutdown.

The route layer should not own bookmark rules.

## CLI Client

The CLI should call the API rather than importing storage handlers directly.
That keeps it honest as a client example.

Commands:

```sh
BOOKMARKS_URL=http://127.0.0.1:3000/api bookmarks list
bookmarks add https://example.com/article --tag typescript --tag effects
bookmarks list --status unread --tag effects --text algebraic
bookmarks read <id>
bookmarks archive <id>
bookmarks refresh <id>
```

`BOOKMARKS_URL` overrides the default API base of
`http://127.0.0.1:3000/api`.

The CLI boundary uses `HttpClient` and `Fail`:

- parse args,
- make HTTP requests,
- print concise output,
- convert network or API errors into user-facing messages.

## Browser Client

The browser client can be a tiny static page:

- URL input,
- tag input,
- unread list,
- archive/read buttons,
- metadata refresh button.

It should call the API with plain `fetch`. The browser client does not need to
use `fx` initially. The main teaching value is that the API server domain remains
the same regardless of client.

If a browser-side `fx` client is added later, it should demonstrate a distinct
point, such as interpreting `HttpClient` differently in browser and CLI.

## Testing Strategy

Focused tests should cover:

- invalid URL returns `Fail<InvalidUrl>`,
- adding a bookmark stores normalized data,
- duplicate URL fails with the existing id,
- metadata failure does not fail bookmark creation,
- mark read fails for missing id,
- archive updates status and timestamp,
- the same domain program works with stub handlers.

Type-level expectations should show that handlers progressively remove effects.
For example:

1. `addBookmark` requires `BookmarkStore | PageMetadata | Time | Random | Log | Fail<...>`.
2. Applying pure test handlers removes `BookmarkStore`, `PageMetadata`, `Time`,
   `Random`, and `Log`.
3. Tests handle `Fail` explicitly.

## Proposed File Layout

```text
examples/bookmarks/
  design.md
  domain.ts
  store-memory.ts
  metadata-real.ts
  metadata-stub.ts
  client.ts
  server.ts
  cli.ts
  domain.test.ts
  cli.test.ts
```

Optional later additions:

```text
examples/bookmarks/
  store-json.ts
  browser/
    index.html
    app.js
  package.json
```

## Implementation Phases

### Phase 1: Domain and pure handlers

Status: implemented.

- Define domain types.
- Define `BookmarkStore` and `PageMetadata` effects.
- Implement `addBookmark`, `listBookmarks`, `markRead`, `archiveBookmark`, and
  `refreshMetadata`.
- Add in-memory and stub metadata handlers.
- Add focused tests.

### Phase 2: API server

Status: implemented.

- Add HTTP routes.
- Interpret domain programs with in-memory handlers.
- Map domain failures to HTTP status codes.
- Add small request-level logging.

### Phase 3: CLI client

Status: implemented.

- Add CLI commands that call the API.
- Keep output compact and script-friendly.
- Convert API errors into clear messages.

### Phase 4: Browser client

- Add a static page that calls the API.
- Keep UI minimal: add, list, mark read, archive, refresh metadata.

### Phase 5: Optional persistence

- Add JSON file storage if persistence improves the example.
- Keep it as a handler swap, not a domain change.

## Open Questions

- Use `Random` directly for ids, or add a tiny `BookmarkIdGenerator` effect?
  Answer: implemented as `BookmarkIdGenerator` so tests and demos have readable,
  deterministic ids.
- Should metadata refresh run synchronously during add, or should add return
  immediately and refresh in the background?
  Answer: synchronous for now; background refresh is deferred.
- Should the first API server use only in-memory storage, or include JSON file
  persistence from the start?
  Answer: in-memory only for the first implementation; JSON persistence remains a
  later handler swap.
- Should the browser client stay plain JavaScript, or should it also demonstrate
  `fx` on the client side?
  Answer: deferred until the browser phase.

## Recommended First Cut

Start with:

- domain programs,
- in-memory store handler,
- stub metadata handler,
- tests,
- API server backed by the in-memory handler.

Defer:

- JSON persistence,
- background metadata jobs,
- browser-side `fx`,
- advanced HTML parsing.

That first cut should already demonstrate the central design point: bookmark
logic is written once as a description of domain operations, and each runtime
chooses how to interpret those operations.
