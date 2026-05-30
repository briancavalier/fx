# Bookmarks Example

This is a small reading queue application that shows how `fx` programs can keep
domain behavior independent from platform handlers.

The example includes:

- an HTTP API server with SQLite persistence,
- a CLI client for adding, listing, and updating bookmarks,
- a browser UI served by the same server,
- focused domain, client, codec, and store tests.

## Run The Server

Build the package exports first because the runnable examples import the public
package subpaths:

```sh
corepack pnpm build
```

Start the API and browser server:

```sh
corepack pnpm exec tsx examples/advanced/bookmarks/server.ts
```

By default the server listens at `http://127.0.0.1:3000/` and stores data in
`bookmarks.sqlite` in the current working directory. You can override those
defaults:

```sh
HOST=127.0.0.1 PORT=3001 BOOKMARKS_DB=/tmp/bookmarks.sqlite \
  corepack pnpm exec tsx examples/advanced/bookmarks/server.ts
```

## Use The CLI

The CLI talks to `http://127.0.0.1:3000/api` by default:

```sh
corepack pnpm exec tsx examples/advanced/bookmarks/cli.ts add https://example.com --tag typescript
corepack pnpm exec tsx examples/advanced/bookmarks/cli.ts list
corepack pnpm exec tsx examples/advanced/bookmarks/cli.ts read bookmark-1
corepack pnpm exec tsx examples/advanced/bookmarks/cli.ts archive bookmark-1
corepack pnpm exec tsx examples/advanced/bookmarks/cli.ts refresh bookmark-1
```

Point it at another server with `BOOKMARKS_URL`:

```sh
BOOKMARKS_URL=http://127.0.0.1:3001/api \
  corepack pnpm exec tsx examples/advanced/bookmarks/cli.ts list --status unread
```

## Use The Browser UI

Build the package and browser assets, then start the server:

```sh
corepack pnpm examples:bookmarks:start
```

Then open:

```text
http://127.0.0.1:3000/
```

The server serves `examples/advanced/bookmarks/browser/index.html` and generated
browser assets under `examples/advanced/bookmarks/browser/.assets`. Browser
assets are ignored by git. If you change the browser source under
`examples/advanced/bookmarks/browser`, rebuild those assets with:

```sh
corepack pnpm examples:bookmarks:build
```

## Tests

Run the whole repository validation:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
```

For only the bookmarks tests:

```sh
corepack pnpm exec node --import tsx --test 'examples/advanced/bookmarks/*.test.ts'
```

## What This Example Highlights

The domain in `domain.ts` is written as effectful programs over capabilities
such as bookmark storage, metadata fetching, time, random ids, and logging. It
does not know whether it is running in tests, over SQLite, behind HTTP, from the
CLI, or in the browser.

The server in `server.ts` interprets HTTP routes with `@briancavalier/fx/http-server`,
uses `transformRoutes` to apply bookmark JSON codecs once to the API route tree,
and keeps request body stream reading at the HTTP boundary.

The client in `client.ts` uses `@briancavalier/fx/http-client` to read response
bodies as UTF-8 text, then decodes bookmark JSON through codec operations. The
exported client functions keep a stable client error surface while their
internal raw programs still expose codec operations.

The codecs in `codec.ts` model JSON text as the encoded form:

- `BookmarkJson: Bookmark <-> string`
- `BookmarksJson: readonly Bookmark[] <-> string`
- `AddBookmarkInputJson: AddBookmarkInput <-> string`

The codec handler is intentionally hand-rolled so the example stays dependency
free. The same boundary could delegate to Zod, Valibot, Arktype, Effect Schema,
Standard Schema-compatible adapters, or application-specific parsing code.

The SQLite store in `store-sqlite.ts` is another handler for the same domain
storage effects used by the tests. That keeps persistence details at the edge
instead of threading database APIs through domain workflows.
