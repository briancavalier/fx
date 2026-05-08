# Internal Source Notes

This directory contains runtime and implementation support for public modules.

Rules for changes:
- Do not add public API from this directory.
- Keep runtime context propagation explicit at interpreter/runtime boundaries.
- Preserve iterator `return`/`throw` behavior when changing handler or fork machinery.
- Keep cancellation and disposal paths explicit; dispose tasks/resources on failure and interruption.
- Respect trace capture policy on every trace path. Avoid stack capture when policy is `off` or `labels`.
- Keep tagging narrowly scoped to yielded effects, thrown errors, and values crossing runtime boundaries.
- Add focused tests when changing async failure handling, scoped cleanup, fork/all/race cancellation, trace propagation, or runtime context tagging.
- Run the relevant benchmark when changing hot paths in `runFork`, trace capture, or runtime context.
