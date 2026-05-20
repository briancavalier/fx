# Fx Examples

The examples are grouped by how much Fx context they assume. Start with `basic`
if you are learning the core model, use `intermediate` for focused runtime
features, and use `advanced` for app-shaped examples that combine several
features.

## Agent routing

Use the smallest example that demonstrates the task:

| Task | Start with | Why |
| --- | --- | --- |
| Minimal runnable program | `basic/hello.ts` | Shows one effect, one handler, and `run` without extra structure. |
| Custom domain effects and pure tests | `basic/guessing-game` | Shows business logic written against effects and interpreted by handlers. |
| HTTP boundary code | `basic/http-server-client` | Shows routes, request context, client/server boundaries, and in-memory handlers. |
| Handler-chosen concurrency semantics | `intermediate/race-handlers.ts` | Shows one request interpreted by different race handlers. |
| Interruption and cleanup | `intermediate/interrupt-safe-finalization.ts` | Shows cancellation, named scopes, and async finalizers. |
| Scoped data-flow or early return | `intermediate/read-csv.ts` | Shows scoped `YieldFrom`, managed resources, transforms, and early return. |
| App-shaped domain organization | `advanced/bookmarks` | Shows domain effects, HTTP, CLI/browser clients, persistence handlers, and tests. |
| Structured concurrency plus resources | `advanced/incident-collector` | Shows `all`, `race`, named scopes, managed resources, finalization, and fixture handlers. |
| Diagnostics and trace formatting | `advanced/diagnostics.ts` | Shows trace capture policy, regional traces, source lookup, and formatted output. |

Avoid starting from an advanced example when a basic or intermediate example
already matches the requested pattern.

## Basic

| Example | What it shows | Best for | Run |
| --- | --- | --- | --- |
| `basic/hello.ts` | A minimal `Fx` program, console effect, handler, and `run`. | First-time readers who want the smallest runnable example. | `node --import tsx examples/basic/hello.ts` |
| `basic/guessing-game` | Custom effects, handler composition, environment input, pure handlers, and tests. | Readers learning how business logic stays independent from interpreters. | `node --import tsx examples/basic/guessing-game/index.ts` |
| `basic/http-server-client` | Small HTTP API routes, server/client boundaries, route context, and in-memory handlers. | Readers who want a compact platform-boundary example. | `node --import tsx examples/basic/http-server-client/server.ts` |

## Intermediate

| Example | What it shows | Best for | Run |
| --- | --- | --- | --- |
| `intermediate/race-handlers.ts` | One `race` request interpreted with first-settled and first-success handlers. | Readers learning how handlers choose semantics. | `node --import tsx examples/intermediate/race-handlers.ts` |
| `intermediate/interrupt-safe-finalization.ts` | Race cancellation, named scopes, and async finalization for interrupted work. | Readers working with resources under structured concurrency. | `node --import tsx examples/intermediate/interrupt-safe-finalization.ts` |
| `intermediate/uninterruptible-mask.ts` | A protected acquire/register critical section with interruptible use. | Readers who need precise interruption boundaries. | `node --import tsx examples/intermediate/uninterruptible-mask.ts` |
| `intermediate/ref.ts` | Atomic shared state updates across concurrent tasks. | Readers modeling safe mutable references. | `node --import tsx examples/intermediate/ref.ts` |
| `intermediate/read-csv.ts` | Scoped `YieldFrom`, row transforms, managed resources, and early return. | Readers exploring scoped data-flow patterns. | `node --import tsx examples/intermediate/read-csv.ts` |
| `intermediate/restart-on-abort.ts` | Scoped abort recovery, restart limits, and cleanup across attempts. | Readers handling recoverable scoped aborts. | `node --import tsx examples/intermediate/restart-on-abort.ts` |

## Advanced

| Example | What it shows | Best for | Run |
| --- | --- | --- | --- |
| `advanced/bookmarks` | A fuller app with domain effects, HTTP, CLI/browser clients, persistence handlers, and tests. | Readers studying how larger Fx applications can be organized. | Server and browser app: `node --import tsx examples/advanced/bookmarks/server.ts`, then open `http://127.0.0.1:3000/`. CLI: with the server running, use `node --import tsx examples/advanced/bookmarks/cli.ts add https://example.com --tag demo` and `node --import tsx examples/advanced/bookmarks/cli.ts list`. |
| `advanced/incident-collector` | Structured concurrency, named scopes, resource finalization, cancellation, fixture handlers, and tests. | Readers studying a realistic concurrent workflow without HTTP/browser scaffolding. | `node --import tsx examples/advanced/incident-collector/cli.ts` |
| `advanced/tool-agent` | Tool-planning workflow with model effects, parallel tool calls, sandbox policy handlers, fixture handlers, and optional OpenAI model integration. | Readers studying agent-like workflows built from explicit effects and handlers. | `node --import tsx examples/advanced/tool-agent/cli.ts` |
| `advanced/diagnostics.ts` | Trace capture policy, regional trace capture, source lookup, formatted diagnostics, and snapshots. | Readers debugging failures and tuning diagnostic detail. | `node --import tsx examples/advanced/diagnostics.ts` |

Runnable TypeScript examples import from `@briancavalier/fx` and the curated
feature subpaths so they match package-consumer code. Run `pnpm build` before
executing examples directly; package self-imports resolve through
`package.json#exports` to `dist/exports/*`.
