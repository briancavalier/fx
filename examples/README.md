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
| Concurrency operators and schedulers | `intermediate/concurrency-handlers.ts` | Shows race operators and scheduler handlers. |
| Scope-owned fork lifetime | `intermediate/scope-owned-forks.ts` | Shows scoped fork lifetime, a scope deadline, and scheduler handler ordering. |
| Interruption and cleanup | `intermediate/interrupt-safe-finalization.ts` | Shows cancellation, named scopes, and async finalizers. |
| Scoped data-flow or early return | `intermediate/read-csv.ts` | Shows scoped `YieldFrom`, managed resources, transforms, and early return. |
| Scoped producer/receiver pipelines | `intermediate/yield-sink-pipeline.ts` | Shows scoped `YieldFrom`, `Sink`, and explicit pipe outcomes. |
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
| `intermediate/concurrency-handlers.ts` | `race` and `firstSuccess` operators, plus one program run with fork-backed and cooperative scheduler handlers. | Readers learning how operators and schedulers compose. | `node --import tsx examples/intermediate/concurrency-handlers.ts` |
| `intermediate/scope-owned-forks.ts` | `forkIn`, `timeoutIn`, scoped cleanup, and the required `withScope` then scheduler handler order. | Readers learning scope-owned child lifetime. | `node --import tsx examples/intermediate/scope-owned-forks.ts` |
| `intermediate/interrupt-safe-finalization.ts` | Race cancellation, named scopes, and async finalization for interrupted work. | Readers working with resources under structured concurrency. | `node --import tsx examples/intermediate/interrupt-safe-finalization.ts` |
| `intermediate/uninterruptible-mask.ts` | Timeout-driven interruption after a protected acquire/register critical section. | Readers who need precise interruption boundaries. | `node --import tsx examples/intermediate/uninterruptible-mask.ts` |
| `intermediate/scoped-state.ts` | Mutable state modeled as named scoped operations and handled state. | Readers exploring structured local state. | `node --import tsx examples/intermediate/scoped-state.ts` |
| `intermediate/transactional-state.ts` | Plain state recovery compared with transactional state rollback for scoped catch regions. | Readers deciding when recovery should preserve or roll back partial state changes. | `node --import tsx examples/intermediate/transactional-state.ts` |
| `intermediate/codec-json.ts` | Branded codec keys for explicit encode/decode boundaries and recoverable invalid input. | Readers modeling external data without coupling domain code to a schema library. | `node --import tsx examples/intermediate/codec-json.ts` |
| `intermediate/read-csv.ts` | Scoped `YieldFrom`, row transforms, managed resources, and early return. | Readers exploring scoped data-flow patterns. | `node --import tsx examples/intermediate/read-csv.ts` |
| `intermediate/yield-sink-pipeline.ts` | Scoped `YieldFrom`, `Sink`, and discriminated pipe results. | Readers connecting push-style producers to pull-style receivers. | `node --import tsx examples/intermediate/yield-sink-pipeline.ts` |
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
`pnpm typecheck`, `pnpm test`, or direct example execution; package self-imports
resolve through `package.json#exports` to `dist/exports/*`.
