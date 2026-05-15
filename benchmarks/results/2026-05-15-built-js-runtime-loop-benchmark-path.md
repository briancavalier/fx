# Built-JS Runtime Loop Benchmark Path

## Candidate

Add a built-JS benchmark path for structural runtime prototypes. The existing `pnpm benchmark:runtime-loops` command runs through `tsx`, which is convenient during development, but structural changes can behave differently once TypeScript has emitted plain JavaScript and Node/V8 sees the final module shapes.

This experiment adds:

- `tsconfig.benchmarks.json`, a benchmark-only TS project that emits `src` and `benchmarks/runtime-loops.ts` into `.benchmark-dist`.
- `pnpm build:benchmarks`, which builds that benchmark output.
- `pnpm benchmark:runtime-loops:js`, which builds and then runs `node .benchmark-dist/benchmarks/runtime-loops.js`.
- `.benchmark-dist/` to `.gitignore`.
- `FX_BENCHMARK_COMMAND` support in the runtime-loop benchmark report so built-JS results identify the command that produced them.

The benchmark build uses `noCheck` intentionally. Type correctness remains covered by `pnpm typecheck`; this path exists to emit benchmark JavaScript that preserves the benchmark source shape closely enough for V8/module-shape comparisons.

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `pnpm build:benchmarks`
- `pnpm benchmark:runtime-loops:js`

## Built-JS Sample

Command: `pnpm benchmark:runtime-loops:js`

| Case | ns/op |
| --- | ---: |
| matched handler throughput | 8,760 |
| prebuilt matched handler throughput | 8,369 |
| direct internal matched handler throughput | 8,931 |
| pass-through depth 0 | 11,122 |
| pass-through depth 16 | 172,793 |
| control resume | 10,418 |
| control short-circuit | 2,303 |
| control pass-through depth 16 | 173,797 |
| capture depth 0 | 2,281 |
| capture depth 16 | 19,913 |
| scope pass-through depth 16 | 305,810 |
| handler capture boundary pass-through depth 16 | 169,262 |
| pure runPromise | 10,951 |
| sequential async x10 | 174,830 |
| fork fanout 16 unbounded | 615,385 |
| all fanout 16 | 178,810 |
| race fanout 16 | 177,315 |

The built-JS numbers are not meant to be compared directly against `tsx` numbers as a single performance claim. They provide a repeatable second guardrail for structural experiments, especially handler/module-shape changes where previous prototypes showed cliffs in matched or depth-0 paths.

## Decision

Keep.

This is measurement infrastructure rather than a runtime optimization. It gives future structural candidates a concrete compiled-JS guardrail without changing the package build or public API. Structural handler experiments should now be rejected unless both `pnpm benchmark:runtime-loops` and `pnpm benchmark:runtime-loops:js` preserve matched and depth-0 hot paths.
