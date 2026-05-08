# Benchmark Notes

Benchmarks provide comparative evidence for runtime and diagnostic overhead.

Rules for changes:
- Prefer small, repeatable cases that isolate one runtime behavior.
- Keep benchmark names stable when preserving historical comparisons.
- Save notable results under `benchmarks/results/YYYY-MM-DD-*.md`.
- Include command, git SHA, worktree state, Node version, and platform in recorded results.
- Do not treat benchmark output as correctness coverage; pair behavior changes with focused tests.
- Run `pnpm benchmark:trace` for trace capture or formatting changes.
- Run `pnpm benchmark:runtime-context` for runtime context propagation changes.
