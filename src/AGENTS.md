# Source Notes

This directory contains the library implementation.

Architecture:
- `Fx.ts`: public computation type and combinators.
- `Effect.ts`: effect construction and effect identity.
- `Handler.ts`: public handler API.
- `exports/`: curated package entrypoints. These are the public import surface;
  implementation files are not public just because they exist.
- `internal/Handler.ts`: generator-level handler machinery.
- `internal/runFork.ts`: runtime for `Async`, `Fork`, `Fail`, and handler context.

Rules for changes:
- Effects should be ordinary `Effect(...)` classes unless runtime support is truly required.
- Simple interpretation belongs in handlers, not in `Fx` itself.
- Use `control` only when a handler needs to decide whether/how to resume.
- For modules defining effects, keep the effect class near the top of the file and document it directly above the declaration.
- Prefer this module order: effect declaration, public constructors/combinators, public handlers, exported support types, internal handler functions, internal helper types/functions.
- Effect constructor/combinator docs should describe the requested effect. Avoid promising semantics that are determined by handlers.
- Handler docs should describe the interpretation that handler provides.
- Prefer pipeable constructors for higher-order effects, e.g. `fx.pipe(retry(options))` or `fx.pipe(timeout(options))`.
- Prefer options objects once an effect constructor has more than one meaningful option or likely future extension point.
- For higher-order scoped effects, preserve effect typing through the request and handler. If failures cross fork/race/task boundaries, convert them to data before racing unless runtime semantics explicitly preserve typed failures.
- When default handlers create errors asynchronously or after handler interpretation, preserve request-site diagnostics with `Breadcrumb`/cause chaining rather than overwriting stacks.
- Keep cleanup paths explicit: call iterator `return`, dispose tasks/resources, and preserve cooperative cancellation.
- When adding or moving public API, update `src/exports/*`, `package.json#exports`,
  `src/exports.test.ts`, and `scripts/check-exports.mjs` together. Keep package
  subpaths tied to feature ownership rather than source filenames.
- Favor small composable functions over new abstractions.
