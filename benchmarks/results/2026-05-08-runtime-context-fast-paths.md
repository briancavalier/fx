# Fx Runtime Context Benchmark Results

- Date: 2026-05-08T01:46:14.801Z
- Git SHA: 743c0dc
- Worktree: dirty
- Node: v24.14.0
- Platform: darwin 25.3.0 arm64
- Command: `npx tsx benchmarks/runtime-context.ts`
- Handled effect programs yield 100 effects per operation.

| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |
| --- | ---: | ---: | ---: | ---: | ---: |
| direct call | 5,000,000 | 4.35 | 1150472349 | 1 | 1.00x |
| withActiveRuntimeContext active | 5,000,000 | 54.09 | 92435324 | 11 | 12.45x |
| handled effects baseline | 25,000 | 211.58 | 118158 | 8463 | 1.00x |
| handled effects global off | 25,000 | 212.46 | 117669 | 8498 | 1.00x |
| handled effects ambient active off | 25,000 | 211.57 | 118162 | 8463 | 1.00x |
| handled effects regional off | 25,000 | 794.77 | 31456 | 31791 | 3.76x |
| handled effects regional labels | 25,000 | 790.78 | 31614 | 31631 | 3.74x |
| handled effects regional full | 25,000 | 790.78 | 31614 | 31631 | 3.74x |
