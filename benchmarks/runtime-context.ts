import { execFileSync } from 'node:child_process'
import { arch, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'

import { Effect } from '../src/Effect.js'
import { fx, ok, run } from '../src/Fx.js'
import { handle } from '../src/Handler.js'
import { setTraceCapturePolicy, withTraceCapture } from '../src/Trace.js'
import type { TraceCapturePolicy } from '../src/Trace.js'
import { withActiveRuntimeContext } from '../src/internal/runtimeContext.js'
import type { RuntimeContext } from '../src/internal/runtimeContext.js'

interface BenchmarkCase {
  readonly name: string
  readonly group: string
  readonly iterations: number
  readonly warmup: number
  readonly policy?: TraceCapturePolicy
  readonly run: () => void
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

class Ping extends Effect('benchmark/Ping')<number, number> { }

const DirectIterations = 5_000_000
const ProgramIterations = 25_000
const EffectsPerProgram = 100
const context: RuntimeContext = { traceCapturePolicy: 'off' }

const pingHandler = handle(Ping, ping => ok(ping.arg + 1))
const program = pingProgram(EffectsPerProgram)
const programOff = program.pipe(withTraceCapture('off'))
const programLabels = program.pipe(withTraceCapture('labels'))
const programFull = program.pipe(withTraceCapture('full'))

const cases: readonly BenchmarkCase[] = [
  benchmark('direct call', 'direct', DirectIterations, 10_000, () => {
    direct()
  }),
  benchmark('withActiveRuntimeContext active', 'direct', DirectIterations, 10_000, () => {
    withActiveRuntimeContext(context, direct)
  }),
  benchmark('handled effects baseline', 'handled effects', ProgramIterations, 250, () => {
    program.pipe(pingHandler, run)
  }),
  benchmark('handled effects global off', 'handled effects', ProgramIterations, 250, () => {
    program.pipe(pingHandler, run)
  }, 'off'),
  benchmark('handled effects ambient active off', 'handled effects', ProgramIterations, 250, () => {
    withActiveRuntimeContext(context, () => program.pipe(pingHandler, run))
  }),
  benchmark('handled effects regional off', 'handled effects', ProgramIterations, 250, () => {
    programOff.pipe(pingHandler, run)
  }),
  benchmark('handled effects regional labels', 'handled effects', ProgramIterations, 250, () => {
    programLabels.pipe(pingHandler, run)
  }),
  benchmark('handled effects regional full', 'handled effects', ProgramIterations, 250, () => {
    programFull.pipe(pingHandler, run)
  })
]

const results = await runBenchmarks(cases)
console.log(formatMarkdown(results))

function benchmark(
  name: string,
  group: string,
  iterations: number,
  warmup: number,
  run: () => void,
  policy?: TraceCapturePolicy
): BenchmarkCase {
  return { name, group, iterations, warmup, policy, run }
}

async function runBenchmarks(benchmarks: readonly BenchmarkCase[]): Promise<readonly Result[]> {
  const rawResults: Omit<Result, 'relativeToGroupBaseline'>[] = []

  for (const b of benchmarks) {
    const previous = b.policy === undefined ? undefined : setTraceCapturePolicy(b.policy)
    try {
      for (let i = 0; i < b.warmup; i++) b.run()

      const start = performance.now()
      for (let i = 0; i < b.iterations; i++) b.run()
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
    '# Fx Runtime Context Benchmark Results',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Git SHA: ${gitSha()}`,
    `- Worktree: ${worktreeState()}`,
    `- Node: ${process.version}`,
    `- Platform: ${platform()} ${release()} ${arch()}`,
    '- Command: `pnpm benchmark:runtime-context`',
    `- Handled effect programs yield ${EffectsPerProgram.toLocaleString()} effects per operation.`,
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

function pingProgram(count: number) {
  return fx(function* () {
    let n = 0
    for (let i = 0; i < count; i++) {
      n = yield* new Ping(n)
    }
    return n
  })
}

function direct(): number {
  return 1
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
