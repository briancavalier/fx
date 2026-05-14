# Candidate 4: Lazy unhandled fork monitor

## Candidate

`runForkInternal` eagerly allocated an unhandled-fork `Promise` and reject closure for every run, including plain `runPromise` programs that never fork. This experiment replaces that eager allocation with a small `UnhandledForkMonitor` that creates the promise only after a `Fork` effect has been observed.

The runtime still activates the monitor before starting a child task, so parent async waits after a fork continue to race against unhandled child failures. This preserves the existing semantics while avoiding the extra promise allocation on non-forking async programs.

The benchmark suite also adds `async after fork x10`, which forks a successful task, performs ten async effects, waits for the task, and returns the async result. This case exercises the activated monitor path separately from the no-fork async path.

## Baseline

Baseline was measured from commit `0e6f6c2` with only the new `async after fork x10` benchmark added.

| Case | ns/op |
| --- | ---: |
| pure runPromise | 12,110 |
| sequential async x10 | 180,430 |
| async after fork x10 | 239,386 |
| fork fanout 16 unbounded | 663,325 |
| fork fanout 16 bounded 1 | 676,099 |
| fork fanout 16 bounded 4 | 663,523 |
| fork fanout 16 bounded 16 | 654,980 |
| all fanout 16 | 220,038 |
| race fanout 16 | 214,518 |

## Candidate Results

Run 1:

| Case | ns/op | Delta |
| --- | ---: | ---: |
| pure runPromise | 11,629 | -4.0% |
| sequential async x10 | 176,263 | -2.3% |
| async after fork x10 | 236,865 | -1.1% |
| fork fanout 16 unbounded | 658,047 | -0.8% |
| fork fanout 16 bounded 1 | 661,983 | -2.1% |
| fork fanout 16 bounded 4 | 658,734 | -0.7% |
| fork fanout 16 bounded 16 | 654,161 | -0.1% |
| all fanout 16 | 211,166 | -4.0% |
| race fanout 16 | 205,887 | -4.0% |

Run 2:

| Case | ns/op | Delta |
| --- | ---: | ---: |
| pure runPromise | 11,744 | -3.0% |
| sequential async x10 | 175,982 | -2.5% |
| async after fork x10 | 237,923 | -0.6% |
| fork fanout 16 unbounded | 674,900 | +1.7% |
| fork fanout 16 bounded 1 | 717,281 | +6.1% |
| fork fanout 16 bounded 4 | 676,021 | +1.9% |
| fork fanout 16 bounded 16 | 661,609 | +1.0% |
| all fanout 16 | 215,913 | -1.9% |
| race fanout 16 | 210,876 | -1.7% |

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm benchmark:runtime-loops` twice

## Decision

Keep.

The strongest expected benefit is for `runPromise` paths that do not fork: the eager unhandled-fork promise disappears entirely, and both measured runs improved `pure runPromise` and `sequential async x10`. The activated fork path is mostly neutral to slightly mixed, which is expected because forked programs still allocate the monitor promise and now pay one small indirection through `UnhandledForkMonitor`.

The benchmark signal is modest rather than decisive, but the implementation is local, keeps the existing unhandled-fork semantics explicit, and reduces work for the common no-fork path.
