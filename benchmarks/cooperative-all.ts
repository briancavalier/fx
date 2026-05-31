import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { arch, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'

import { assertPromise } from '../src/Async.js'
import { all, firstSuccess, fork, forkIn, race, withBoundedConcurrency, withUnboundedConcurrency } from '../src/Concurrent.js'
import { withCoopConcurrency } from '../src/experimental/concurrent/cooperative.js'
import { Effect } from '../src/Effect.js'
import { fail, returnFail } from '../src/Fail.js'
import { andFinally } from '../src/Finalization.js'
import { fx, ok, runPromise } from '../src/Fx.js'
import { handle } from '../src/Handler.js'
import { scope, withScope } from '../src/Scope.js'
import { wait } from '../src/Task.js'
import type { Fx } from '../src/Fx.js'

interface BenchmarkCase {
  readonly name: string
  readonly group: string
  readonly run: () => Promise<void>
}

interface Result {
  readonly name: string
  readonly group: string
  readonly iterations: number
  readonly opsPerSecond: number
  readonly samples: readonly number[]
  readonly medianNsPerOp: number
  readonly minNsPerOp: number
  readonly p75NsPerOp: number
  readonly maxNsPerOp: number
  readonly spread: number
  readonly relativeToGroupBaseline: number
}

interface FairnessSummary {
  readonly name: string
  readonly totalSteps: number
  readonly maxConsecutiveSteps: number
  readonly firstStepPositions: readonly number[]
  readonly firstStepSpread: number
}

class Step extends Effect('benchmark/cooperative-all/Step')<{ readonly id: number, readonly step: number }, void> { }

const Fanout = 16
const StepsPerChild = 16
const Samples = 7
const WarmupIterations = 3
const TargetSampleMs = 250
const CalibrationTargetMs = TargetSampleMs / 2
const MaxCalibrationIterations = 65_536
const NoiseSpreadThreshold = 1.25
const CleanupScope = scope('benchmark/cooperative-all/Cleanup')
const JoinScope = scope('benchmark/cooperative-all/Join')

await runSemanticChecks()

const fairness = [
  await measureFairness('withUnboundedConcurrency', f => f.pipe(withUnboundedConcurrency)),
  await measureFairness('withCoopConcurrency budget 1', f => f.pipe(withCoopConcurrency({ yieldBudget: 1 }))),
  await measureFairness('withCoopConcurrency budget 8', f => f.pipe(withCoopConcurrency({ yieldBudget: 8 }))),
  await measureFairness('withCoopConcurrency budget 64', f => f.pipe(withCoopConcurrency({ yieldBudget: 64 })))
]

const results = await runBenchmarks([
  benchmark('withUnboundedConcurrency ok fanout 16', 'ok fanout', async () => {
    await all(okChildren(Fanout)).pipe(withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency ok fanout 16', 'ok fanout', async () => {
    await all(okChildren(Fanout)).pipe(withCoopConcurrency(), runPromise)
  }),
  benchmark('withUnboundedConcurrency async fanout 16', 'async fanout', async () => {
    await all(asyncChildren(Fanout)).pipe(withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency async fanout 16', 'async fanout', async () => {
    await all(asyncChildren(Fanout)).pipe(withCoopConcurrency(), runPromise)
  }),
  benchmark('withUnboundedConcurrency explicit fork fanout 16', 'explicit fork fanout', async () => {
    await explicitForkFanout(okChildren(Fanout)).pipe(withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency explicit fork fanout 16', 'explicit fork fanout', async () => {
    await explicitForkFanout(okChildren(Fanout)).pipe(withCoopConcurrency(), runPromise)
  }),
  benchmark('withBoundedConcurrency explicit fork fanout 16 limit 1', 'queued slots', async () => {
    await explicitForkFanout(asyncChildren(Fanout)).pipe(withBoundedConcurrency(1), runPromise)
  }),
  benchmark('withCoopConcurrency explicit fork fanout 16 limit 1', 'queued slots', async () => {
    await explicitForkFanout(asyncChildren(Fanout)).pipe(withCoopConcurrency({ concurrency: 1 }), runPromise)
  }),
  benchmark('withUnboundedConcurrency scoped join fanout 16', 'scoped join', async () => {
    await scopedJoinFanout(Fanout).pipe(withUnboundedConcurrency, returnFail, runPromise)
  }),
  benchmark('withCoopConcurrency scoped join fanout 16', 'scoped join', async () => {
    await scopedJoinFanout(Fanout).pipe(withCoopConcurrency(), returnFail, runPromise)
  }),
  benchmark('withUnboundedConcurrency yielding 16x16', 'yielding fanout', async () => {
    await yieldingAll().pipe(handleStep(), withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency yielding 16x16 budget 1', 'yielding fanout', async () => {
    await yieldingAll().pipe(withCoopConcurrency({ yieldBudget: 1 }), handleStep(), runPromise)
  }),
  benchmark('withCoopConcurrency yielding 16x16 budget 8', 'yielding fanout', async () => {
    await yieldingAll().pipe(withCoopConcurrency({ yieldBudget: 8 }), handleStep(), runPromise)
  }),
  benchmark('withCoopConcurrency yielding 16x16 budget 64', 'yielding fanout', async () => {
    await yieldingAll().pipe(withCoopConcurrency({ yieldBudget: 64 }), handleStep(), runPromise)
  }),
  benchmark('withUnboundedConcurrency mixed parked async', 'mixed async', async () => {
    await mixedAsyncAndYielding().pipe(handleStep(), withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency mixed parked async budget 1', 'mixed async', async () => {
    await mixedAsyncAndYielding().pipe(withCoopConcurrency({ yieldBudget: 1 }), handleStep(), runPromise)
  }),
  benchmark('race + withUnboundedConcurrency nested race', 'nested race', async () => {
    await nestedRace().pipe(handleStep(), withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency nested race', 'nested race', async () => {
    await nestedRace().pipe(withCoopConcurrency(), handleStep(), runPromise)
  }),
  benchmark('firstSuccess withUnboundedConcurrency nested firstSuccess', 'nested firstSuccess', async () => {
    await nestedFirstSuccess().pipe(handleStep(), withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency nested firstSuccess', 'nested firstSuccess', async () => {
    await nestedFirstSuccess().pipe(withCoopConcurrency(), handleStep(), runPromise)
  }),
  benchmark('withUnboundedConcurrency cancel cleanup', 'cleanup', async () => {
    await cleanupFailureProgram().pipe(withScope(CleanupScope), withUnboundedConcurrency, returnFail, runPromise)
  }),
  benchmark('withCoopConcurrency cancel cleanup', 'cleanup', async () => {
    await cleanupFailureProgram().pipe(withCoopConcurrency(), withScope(CleanupScope), returnFail, runPromise)
  })
])

console.log(formatMarkdown(fairness, results))

async function runSemanticChecks(): Promise<void> {
  const defaultResult = await parityProgram().pipe(handleStep(), withScope(CleanupScope), withUnboundedConcurrency, returnFail, runPromise)
  const cooperativeResult = await parityProgram().pipe(withCoopConcurrency({ yieldBudget: 1 }), handleStep(), withScope(CleanupScope), returnFail, runPromise)

  assert.deepEqual(defaultResult, cooperativeResult)

  const defaultFailure = await cleanupFailureProgram().pipe(withScope(CleanupScope), withUnboundedConcurrency, returnFail, runPromise)
  const cooperativeFailure = await cleanupFailureProgram().pipe(withCoopConcurrency(), withScope(CleanupScope), returnFail, runPromise)

  assert.equal(defaultFailure.constructor, cooperativeFailure.constructor)
  assert.ok('arg' in defaultFailure && 'arg' in cooperativeFailure)
  assert.ok(defaultFailure.arg instanceof AggregateError)
  assert.ok(cooperativeFailure.arg instanceof AggregateError)
  assert.equal(defaultFailure.arg.message, cooperativeFailure.arg.message)
  assert.equal(defaultFailure.arg.errors.length, cooperativeFailure.arg.errors.length)
}

function benchmark(
  name: string,
  group: string,
  run: () => Promise<void>
): BenchmarkCase {
  return { name, group, run }
}

async function runBenchmarks(benchmarks: readonly BenchmarkCase[]): Promise<readonly Result[]> {
  const groups = groupedBenchmarks(benchmarks)
  const rawResults = new Map<BenchmarkCase, { iterations: number, samples: number[] }>()

  for (const b of benchmarks) {
    await warmup(b)
    rawResults.set(b, { iterations: await calibrateIterations(b), samples: [] })
  }

  for (const group of groups) {
    for (let sample = 0; sample < Samples; sample++) {
      const ordered = sample % 2 === 0
        ? group
        : [...group.slice(1), group[0]]
      for (const b of ordered) {
        const result = rawResults.get(b)!
        result.samples.push(await sampleNsPerOp(b, result.iterations))
      }
    }
  }

  const baselines = new Map<string, number>()
  const results = benchmarks.map(b => {
    const raw = rawResults.get(b)!
    const samples = [...raw.samples].sort((a, b) => a - b)
    const minNsPerOp = samples[0]
    const maxNsPerOp = samples[samples.length - 1]
    const medianNsPerOp = percentile(samples, 0.5)
    const p75NsPerOp = percentile(samples, 0.75)
    const spread = maxNsPerOp / minNsPerOp
    const result: Omit<Result, 'relativeToGroupBaseline'> = {
      name: b.name,
      group: b.group,
      iterations: raw.iterations,
      opsPerSecond: 1_000_000_000 / medianNsPerOp,
      samples,
      medianNsPerOp,
      minNsPerOp,
      p75NsPerOp,
      maxNsPerOp,
      spread
    }
    if (!baselines.has(result.group)) baselines.set(result.group, result.medianNsPerOp)
    return result
  })

  return results.map(result => ({
    ...result,
    relativeToGroupBaseline: result.medianNsPerOp / (baselines.get(result.group) ?? result.medianNsPerOp)
  }))
}

function groupedBenchmarks(benchmarks: readonly BenchmarkCase[]): readonly BenchmarkCase[][] {
  const groups = [] as BenchmarkCase[][]
  const byName = new Map<string, BenchmarkCase[]>()
  for (const b of benchmarks) {
    let group = byName.get(b.group)
    if (group === undefined) {
      group = []
      byName.set(b.group, group)
      groups.push(group)
    }
    group.push(b)
  }
  return groups
}

async function warmup(b: BenchmarkCase): Promise<void> {
  for (let i = 0; i < WarmupIterations; i++) await b.run()
}

async function calibrateIterations(b: BenchmarkCase): Promise<number> {
  let iterations = 1
  while (true) {
    const totalMs = await timeIterations(b, iterations)
    if (totalMs >= CalibrationTargetMs || iterations >= MaxCalibrationIterations) return iterations
    iterations *= 2
  }
}

async function sampleNsPerOp(b: BenchmarkCase, iterations: number): Promise<number> {
  const totalMs = await timeIterations(b, iterations)
  return (totalMs * 1_000_000) / iterations
}

async function timeIterations(b: BenchmarkCase, iterations: number): Promise<number> {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) await b.run()
  return performance.now() - start
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.ceil(sorted.length * p) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

async function measureFairness(
  name: string,
  handler: (f: Fx<any, readonly number[]>) => Fx<any, readonly number[]>
): Promise<FairnessSummary> {
  const events = [] as { readonly id: number, readonly step: number }[]

  await yieldingAll().pipe(
    handler,
    handle(Step, step => fx(function* () {
      events.push(step.arg)
    })),
    runPromise
  )

  return {
    name,
    totalSteps: events.length,
    maxConsecutiveSteps: maxConsecutive(events),
    firstStepPositions: firstStepPositions(events, Fanout),
    firstStepSpread: firstStepSpread(events, Fanout)
  }
}

function yieldingAll() {
  return all(Array.from({ length: Fanout }, (_, id) => yieldingChild(id, StepsPerChild)))
}

function yieldingChild(id: number, steps: number) {
  return fx(function* () {
    for (let step = 0; step < steps; step++) {
      yield* new Step({ id, step })
    }
    return id
  })
}

function mixedAsyncAndYielding() {
  return all([
    assertPromise(() => new Promise<string>(resolve => setImmediate(() => resolve('async')))),
    ...Array.from({ length: 7 }, (_, id) => yieldingChild(id, StepsPerChild))
  ])
}

function explicitForkFanout(children: readonly Fx<any, unknown>[]) {
  return fx(function* () {
    const tasks = []
    for (const child of children) tasks.push(yield* fork(child))
    const results = []
    for (const task of tasks) results.push(yield* wait(task))
    return results
  })
}

function scopedJoinFanout(length: number) {
  return fx(function* () {
    for (let i = 0; i < length; i++) {
      yield* forkIn(JoinScope, assertPromise(() => Promise.resolve(i)))
    }
    return 'parent'
  }).pipe(withScope(JoinScope))
}

function nestedRace() {
  return all([
    race([
      assertPromise(() => new Promise<string>(resolve => setImmediate(() => resolve('slow')))),
      ok('fast')
    ]),
    yieldingChild(0, 2)
  ])
}

function nestedFirstSuccess() {
  return all([
    firstSuccess([
      fx(function* () {
        yield* fail(new Error('primary failed'))
      }),
      assertPromise(() => Promise.resolve('replica'))
    ]),
    yieldingChild(0, 2)
  ])
}

function parityProgram() {
  return all([
    ok(1),
    assertPromise(() => Promise.resolve('async')),
    yieldingChild(1, 2)
  ])
}

function cleanupFailureProgram() {
  const primary = new Error('primary')
  const release = new Error('release')
  const slow = fx(function* () {
    yield* andFinally(CleanupScope, fail(release))
    yield* assertPromise<void>(signal => new Promise(resolve => {
      signal.addEventListener('abort', () => resolve(), { once: true })
    }))
  })
  const bad = fx(function* () {
    yield* assertPromise(() => Promise.resolve())
    yield* fail(primary)
  })
  return all([slow, bad])
}

function okChildren(length: number) {
  return Array.from({ length }, (_, i) => ok(i))
}

function asyncChildren(length: number) {
  return Array.from({ length }, (_, i) => assertPromise(() => Promise.resolve(i)))
}

function handleStep() {
  return handle(Step, () => ok(undefined))
}

function maxConsecutive(events: readonly { readonly id: number }[]): number {
  let max = 0
  let current = 0
  let previous: number | undefined
  for (const event of events) {
    current = event.id === previous ? current + 1 : 1
    previous = event.id
    max = Math.max(max, current)
  }
  return max
}

function firstStepPositions(events: readonly { readonly id: number }[], fanout: number): readonly number[] {
  const positions = Array.from({ length: fanout }, () => -1)
  for (let i = 0; i < events.length; i++) {
    if (positions[events[i].id] < 0) positions[events[i].id] = i
  }
  return positions
}

function firstStepSpread(events: readonly { readonly id: number }[], fanout: number): number {
  const positions = firstStepPositions(events, fanout)
  return Math.max(...positions) - Math.min(...positions)
}

function formatMarkdown(fairness: readonly FairnessSummary[], results: readonly Result[]): string {
  return [
    '# Cooperative All Evaluation',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Git SHA: ${gitSha()}`,
    `- Worktree: ${worktreeState()}`,
    `- Node: ${process.version}`,
    `- Platform: ${platform()} ${release()} ${arch()}`,
    `- Command: \`${benchmarkCommand()}\``,
    '',
    '## Semantic Checks',
    '',
    '- Parity success/failure checks: pass',
    '',
    '## Fairness',
    '',
    '| Case | Total steps | Max consecutive same-child steps | First-step spread |',
    '| --- | ---: | ---: | ---: |',
    ...fairness.map(result =>
      `| ${result.name} | ${result.totalSteps} | ${result.maxConsecutiveSteps} | ${result.firstStepSpread} |`
    ),
    '',
    '## Performance',
    '',
    'Relative values use median ns/op; noisy rows have max/min > 1.25.',
    '',
    '| Case | Samples | Iterations/sample | Ops/sec | Median ns/op | Min ns/op | P75 ns/op | Max ns/op | Relative to group baseline | Noise |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...results.map(result => [
      `| ${result.name}`,
      result.samples.length.toLocaleString(),
      result.iterations.toLocaleString(),
      result.opsPerSecond.toFixed(0),
      result.medianNsPerOp.toFixed(0),
      result.minNsPerOp.toFixed(0),
      result.p75NsPerOp.toFixed(0),
      result.maxNsPerOp.toFixed(0),
      `${result.relativeToGroupBaseline.toFixed(2)}x`,
      `${result.spread <= NoiseSpreadThreshold ? 'ok' : 'noisy'} |`
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

function benchmarkCommand(): string {
  return process.env.npm_lifecycle_event === undefined
    ? 'node benchmarks/cooperative-all'
    : `pnpm ${process.env.npm_lifecycle_event}`
}

function worktreeState(): string {
  try {
    return execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim() || 'clean'
  } catch {
    return 'unknown'
  }
}
