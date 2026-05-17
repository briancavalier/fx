# Isolated Handler Transpile and V8 Comparison

This comparison isolates ordinary handler execution from the full runtime-loop suite and compares:

- clean baseline source through `tsx`
- lazy adjacent-handler prototype source through `tsx`
- clean baseline `tsc` output through `node`
- lazy adjacent-handler prototype `tsc` output through `node`

The baseline worktree was created detached at `main` in `/private/tmp/fx-runtime-loop-compare-baseline`. The prototype worktree was `/private/tmp/fx-runtime-loop-benchmarks`.

## Source via `tsx`

Command:

```sh
pnpm exec tsx /private/tmp/fx-isolated-handler-bench.ts <repo-root> src
```

| Case | Baseline ns/op | Prototype ns/op |
| --- | ---: | ---: |
| public matched construct+run | 12,130 | 195,006 |
| public matched prebuilt | 13,615 | 183,184 |
| direct internal matched prebuilt | 12,955 | 185,245 |
| public pass-through depth 0 | 14,145 | 187,063 |
| public pass-through depth 16 | 196,299 | 196,265 |
| public prebuilt pass-through depth 16 | 193,284 | 211,646 |
| direct internal prebuilt pass-through depth 16 | 192,703 | 194,263 |

## Built JS via `tsc` + `node`

Commands:

```sh
pnpm exec tsc --project /private/tmp/fx-runtime-loop-compare-baseline/tsconfig.build.json --typeRoots /private/tmp/fx-runtime-loop-benchmarks/node_modules/@types
pnpm build
node /private/tmp/fx-isolated-handler-bench.mjs <repo-root> dist
```

| Case | Baseline ns/op | Prototype ns/op |
| --- | ---: | ---: |
| public matched construct+run | 9,758 | 117,285 |
| public matched prebuilt | 10,182 | 110,190 |
| direct internal matched prebuilt | 10,588 | 111,662 |
| public pass-through depth 0 | 11,655 | 115,777 |
| public pass-through depth 16 | 179,428 | 121,797 |
| public prebuilt pass-through depth 16 | 175,833 | 117,163 |
| direct internal prebuilt pass-through depth 16 | 177,140 | 116,495 |

## Interpretation

This is not only a `tsx` or esbuild artifact. The `tsx` source path shows the largest optimization cliff, but built JS still regresses the single-handler path by about 10x.

The prototype does prove that adjacent coalescing can reduce depth scaling in built JS: depth 16 improves from about 175-179k ns/op to about 116-122k ns/op. However, that win is not acceptable because depth 0 and matched handler throughput regress from about 10-12k ns/op to about 110-117k ns/op.

The most likely explanation is V8 optimization sensitivity to module/class/generator shape. The key signal is that `direct internal matched prebuilt` regresses even though `src/internal/Handler.ts` has no diff in the prototype. Import graph and class identity shape are enough to perturb optimization of ordinary handler execution.

Next investigation should use V8 optimization diagnostics on the isolated benchmark:

- run a tiny matched-handler-only benchmark with `--trace-opt --trace-deopt`
- compare baseline vs prototype built JS
- inspect whether `Handler.[Symbol.iterator]`, `step`, `run`, or generator resume paths deopt or fail to optimize
- test an integration that avoids changing public `Handler.ts` imports, such as an explicit opt-in coalescing constructor used only by benchmarks, before considering production integration
