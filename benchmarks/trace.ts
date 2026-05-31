import { performance } from 'node:perf_hooks'
import { arch, platform, release } from 'node:os'
import { execFileSync } from 'node:child_process'

import { assertPromise } from '../src/Async.js'
import { all, fork, forkEach, race, withUnboundedConcurrency } from '../src/Concurrent.js'
import { fail, returnFail } from '../src/Fail.js'
import { flatMap, fx, ok, run, runPromise } from '../src/Fx.js'
import { wait } from '../src/Task.js'
import { at } from '../src/Breadcrumb.js'
import { appendTrace, formatTrace, prependTrace, setTraceCapturePolicy } from '../src/Trace.js'
import type { Trace, TraceCapturePolicy } from '../src/Trace.js'

interface BenchmarkCase {
  readonly name: string
  readonly group: string
  readonly iterations: number
  readonly warmup: number
  readonly policy?: TraceCapturePolicy
  readonly run: () => void | Promise<void>
}

interface Result {
  readonly name: string
  readonly group: string
  readonly iterations: number
  readonly totalMs: number
  readonly opsPerSecond: number
  readonly nsPerOp: number
  readonly relativeToGroupBaseline: number
}

const AsyncIterations = 5_000
const FailureIterations = 2_000
const SyncIterations = 50_000
const FormatIterations = 25_000
const TraceIterations = 25_000

const cases: readonly BenchmarkCase[] = [
  benchmark('pure runtime baseline', 'runtime', SyncIterations, 2_000, () => {
    ok(1).pipe(run)
  }),
  benchmark('handled fail', 'runtime', FailureIterations, 250, () => {
    fail('handled').pipe(returnFail, run)
  }),
  benchmark('prebuilt handled fail', 'runtime', FailureIterations, 250, () => {
    prebuiltHandledFail.pipe(returnFail, run)
  }),
  benchmark('handled fail labels', 'runtime', FailureIterations, 250, () => {
    fail('handled').pipe(returnFail, run)
  }, 'labels'),
  benchmark('handled fail off', 'runtime', FailureIterations, 250, () => {
    fail('handled').pipe(returnFail, run)
  }, 'off'),
  benchmark('unhandled fail', 'runtime', FailureIterations, 100, async () => {
    try {
      await runPromise(fail('unhandled') as never)
    } catch { }
  }),
  benchmark('successful assertPromise', 'runtime', AsyncIterations, 250, async () => {
    await runPromise(assertPromise(() => Promise.resolve(1)))
  }),
  benchmark('prebuilt successful assertPromise', 'runtime', AsyncIterations, 250, async () => {
    await runPromise(prebuiltSuccessfulAsync)
  }),
  benchmark('successful assertPromise labels', 'runtime', AsyncIterations, 250, async () => {
    await runPromise(assertPromise(() => Promise.resolve(1)))
  }, 'labels'),
  benchmark('successful assertPromise off', 'runtime', AsyncIterations, 250, async () => {
    await runPromise(assertPromise(() => Promise.resolve(1)))
  }, 'off'),
  benchmark('rejected assertPromise', 'runtime', FailureIterations, 100, async () => {
    try {
      await runPromise(assertPromise(() => Promise.reject(new Error('rejected'))))
    } catch { }
  }),
  benchmark('nested fork failure', 'runtime', FailureIterations, 100, async () => {
    try {
      await nestedForkFailure(4).pipe(withUnboundedConcurrency, runPromise)
    } catch { }
  }),
  benchmark('nested fork success', 'runtime', FailureIterations, 100, async () => {
    await nestedForkSuccess(4).pipe(withUnboundedConcurrency, runPromise)
  }),
  benchmark('nested fork failure labels', 'runtime', FailureIterations, 100, async () => {
    try {
      await nestedForkFailure(4).pipe(withUnboundedConcurrency, runPromise)
    } catch { }
  }, 'labels'),
  benchmark('nested fork failure off', 'runtime', FailureIterations, 100, async () => {
    try {
      await nestedForkFailure(4).pipe(withUnboundedConcurrency, runPromise)
    } catch { }
  }, 'off'),
  benchmark('all structured failure', 'runtime', FailureIterations, 100, async () => {
    try {
      await all(structuredChildren()).pipe(withUnboundedConcurrency, runPromise)
    } catch { }
  }),
  benchmark('forkEach structured failure', 'runtime', FailureIterations, 100, async () => {
    try {
      await forkEach(structuredChildren()).pipe(
        flatMap(([, failed]) => wait(failed)),
        withUnboundedConcurrency,
        runPromise
      )
    } catch { }
  }),
  benchmark('race structured failure', 'runtime', FailureIterations, 100, async () => {
    try {
      await race(structuredChildren()).pipe(withUnboundedConcurrency, runPromise)
    } catch { }
  }),
  benchmark('plain breadcrumb object', 'capture', TraceIterations, 1_000, () => {
    void ({ message: 'benchmark/plain' })
  }),
  benchmark('capture breadcrumb stack', 'capture', TraceIterations, 1_000, () => {
    at('benchmark/captured')
  }),
  benchmark('capture breadcrumb labels', 'capture', TraceIterations, 1_000, () => {
    at('benchmark/captured')
  }, 'labels'),
  benchmark('capture breadcrumb off', 'capture', TraceIterations, 1_000, () => {
    at('benchmark/captured')
  }, 'off'),
  benchmark('append trace 1 + 1', 'merge', TraceIterations, 1_000, () => {
    appendTrace(shortTrace, shortParentTrace)
  }),
  benchmark('append trace 16 + 16', 'merge', TraceIterations, 1_000, () => {
    appendTrace(longTrace, longParentTrace)
  }),
  ...formatBenchmarks()
]

const shortTrace = traceOfDepth(1)
const shortParentTrace = traceOfDepth(1)
const longTrace = traceOfDepth(16)
const longParentTrace = traceOfDepth(16)
const prebuiltHandledFail = fail('prebuilt handled')
const prebuiltSuccessfulAsync = assertPromise(() => Promise.resolve(1))

const results = await runBenchmarks(cases)
console.log(formatMarkdown(results))

function benchmark(
  name: string,
  group: string,
  iterations: number,
  warmup: number,
  run: () => void | Promise<void>,
  policy?: TraceCapturePolicy
): BenchmarkCase {
  return { name, group, iterations, warmup, policy, run }
}

async function runBenchmarks(benchmarks: readonly BenchmarkCase[]): Promise<readonly Result[]> {
  const rawResults: Omit<Result, 'relativeToGroupBaseline'>[] = []

  for (const b of benchmarks) {
    const previous = b.policy === undefined ? undefined : setTraceCapturePolicy(b.policy)
    try {
      for (let i = 0; i < b.warmup; i++) await b.run()

      const start = performance.now()
      for (let i = 0; i < b.iterations; i++) await b.run()
      const totalMs = performance.now() - start
      const opsPerSecond = b.iterations / (totalMs / 1_000)
      const nsPerOp = (totalMs * 1_000_000) / b.iterations

      rawResults.push({
        name: b.name,
        group: b.group,
        iterations: b.iterations,
        totalMs,
        opsPerSecond,
        nsPerOp
      })
    } finally {
      if (previous !== undefined) setTraceCapturePolicy(previous)
    }
  }

  const baselines = new Map<string, number>()
  for (const result of rawResults) {
    if (!baselines.has(result.group)) baselines.set(result.group, result.nsPerOp)
  }

  return rawResults.map(result => ({
    ...result,
    relativeToGroupBaseline: result.nsPerOp / (baselines.get(result.group) ?? result.nsPerOp)
  }))
}

function formatMarkdown(results: readonly Result[]): string {
  return [
    '# Fx Trace Benchmark Results',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Git SHA: ${gitSha()}`,
    `- Worktree: ${worktreeState()}`,
    `- Node: ${process.version}`,
    `- Platform: ${platform()} ${release()} ${arch()}`,
    '- Command: `pnpm benchmark:trace`',
    '',
    '| Case | Iterations | Total ms | Ops/sec | ns/op | Relative |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...results.map(result => [
      `| ${result.name}`,
      result.iterations.toLocaleString(),
      result.totalMs.toFixed(2),
      result.opsPerSecond.toFixed(0),
      result.nsPerOp.toFixed(0),
      `${result.relativeToGroupBaseline.toFixed(2)}x |`
    ].join(' | '))
  ].join('\n')
}

function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function worktreeState(): string {
  try {
    execFileSync('git', ['diff', '--quiet'])
    execFileSync('git', ['diff', '--cached', '--quiet'])
    return 'clean'
  } catch {
    return 'dirty'
  }
}

function nestedForkFailure(depth: number) {
  if (depth === 0) return fail(new Error('nested failure'))
  return fx(function* () {
    const task = yield* fork(nestedForkFailure(depth - 1))
    return yield* wait(task)
  })
}

function nestedForkSuccess(depth: number) {
  if (depth === 0) return ok('nested success')
  return fx(function* () {
    const task = yield* fork(nestedForkSuccess(depth - 1))
    return yield* wait(task)
  })
}

function structuredChildren() {
  return [
    ok('first'),
    fail(new Error('structured failure')),
    ok('third'),
    ok('fourth')
  ] as const
}

function formatBenchmarks(): readonly BenchmarkCase[] {
  return [1, 8, 16, 32].map(depth => {
    const trace = traceOfDepth(depth)
    return benchmark(`format trace ${depth} frame${depth === 1 ? '' : 's'}`, 'format', FormatIterations, 1_000, () => {
      formatTrace(trace)
    })
  })
}

function traceOfDepth(depth: number): Trace {
  let trace = prependTrace(at('benchmark/frame-0'))
  for (let i = 1; i < depth; i++) {
    trace = prependTrace(at(`benchmark/frame-${i}`), trace)
  }
  return trace
}
