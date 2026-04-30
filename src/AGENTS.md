# Source Notes

This directory contains the library implementation.

Architecture:
- `Fx.ts`: public computation type and combinators.
- `Effect.ts`: effect construction and effect identity.
- `Handler.ts`: public handler API.
- `internal/Handler.ts`: generator-level handler machinery.
- `internal/runFork.ts`: runtime for `Async`, `Fork`, `Fail`, and handler context.

Rules for changes:
- Effects should be ordinary `Effect(...)` classes unless runtime support is truly required.
- Simple interpretation belongs in handlers, not in `Fx` itself.
- Use `control` only when a handler needs to decide whether/how to resume.
- Keep cleanup paths explicit: call iterator `return`, dispose tasks/resources, and preserve cooperative cancellation.
- Favor small composable functions over new abstractions.
