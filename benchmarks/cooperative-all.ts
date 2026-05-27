import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { arch, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'

import { assertPromise } from '../src/Async.js'
import { all, firstSettled, firstSuccess, race, withCoopConcurrency, withUnboundedConcurrency } from '../src/Concurrent.js'
import { Effect } from '../src/Effect.js'
import { fail, returnFail } from '../src/Fail.js'
import { andFinally } from '../src/Finalization.js'
import { fx, ok, runPromise } from '../src/Fx.js'
import { handle } from '../src/Handler.js'
import { scope, withScope } from '../src/Scope.js'
import type { Fx } from '../src/Fx.js'

interface BenchmarkCase {
  readonly name: string
  readonly group: string
  readonly iterations: number
  readonly warmup: number
  readonly run: () => Promise<void>
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
const FastIterations = 1_000
const YieldingIterations = 250
const CleanupIterations = 250
const CleanupScope = scope('benchmark/cooperative-all/Cleanup')

await runSemanticChecks()

const fairness = [
  await measureFairness('withUnboundedConcurrency', f => f.pipe(withUnboundedConcurrency)),
  await measureFairness('withCoopConcurrency budget 1', f => f.pipe(withCoopConcurrency({ yieldBudget: 1 }))),
  await measureFairness('withCoopConcurrency budget 8', f => f.pipe(withCoopConcurrency({ yieldBudget: 8 }))),
  await measureFairness('withCoopConcurrency budget 64', f => f.pipe(withCoopConcurrency({ yieldBudget: 64 })))
]

const results = await runBenchmarks([
  benchmark('withUnboundedConcurrency ok fanout 16', 'ok fanout', FastIterations, 100, async () => {
    await all(okChildren(Fanout)).pipe(withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency ok fanout 16', 'ok fanout', FastIterations, 100, async () => {
    await all(okChildren(Fanout)).pipe(withCoopConcurrency(), runPromise)
  }),
  benchmark('withUnboundedConcurrency async fanout 16', 'async fanout', FastIterations, 100, async () => {
    await all(asyncChildren(Fanout)).pipe(withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency async fanout 16', 'async fanout', FastIterations, 100, async () => {
    await all(asyncChildren(Fanout)).pipe(withCoopConcurrency(), runPromise)
  }),
  benchmark('withUnboundedConcurrency yielding 16x16', 'yielding fanout', YieldingIterations, 50, async () => {
    await yieldingAll().pipe(handleStep(), withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency yielding 16x16 budget 1', 'yielding fanout', YieldingIterations, 50, async () => {
    await yieldingAll().pipe(withCoopConcurrency({ yieldBudget: 1 }), handleStep(), runPromise)
  }),
  benchmark('withCoopConcurrency yielding 16x16 budget 8', 'yielding fanout', YieldingIterations, 50, async () => {
    await yieldingAll().pipe(withCoopConcurrency({ yieldBudget: 8 }), handleStep(), runPromise)
  }),
  benchmark('withCoopConcurrency yielding 16x16 budget 64', 'yielding fanout', YieldingIterations, 50, async () => {
    await yieldingAll().pipe(withCoopConcurrency({ yieldBudget: 64 }), handleStep(), runPromise)
  }),
  benchmark('withUnboundedConcurrency mixed parked async', 'mixed async', YieldingIterations, 50, async () => {
    await mixedAsyncAndYielding().pipe(handleStep(), withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency mixed parked async budget 1', 'mixed async', YieldingIterations, 50, async () => {
    await mixedAsyncAndYielding().pipe(withCoopConcurrency({ yieldBudget: 1 }), handleStep(), runPromise)
  }),
  benchmark('firstSettled + withUnboundedConcurrency nested race', 'nested race', YieldingIterations, 50, async () => {
    await nestedRace().pipe(firstSettled, handleStep(), withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency nested race', 'nested race', YieldingIterations, 50, async () => {
    await nestedRace().pipe(firstSettled, withCoopConcurrency(), handleStep(), runPromise)
  }),
  benchmark('firstSuccess + withUnboundedConcurrency nested firstSuccess', 'nested firstSuccess', YieldingIterations, 50, async () => {
    await nestedFirstSuccess().pipe(firstSuccess, handleStep(), withUnboundedConcurrency, runPromise)
  }),
  benchmark('withCoopConcurrency nested firstSuccess', 'nested firstSuccess', YieldingIterations, 50, async () => {
    await nestedFirstSuccess().pipe(firstSuccess, withCoopConcurrency(), handleStep(), runPromise)
  }),
  benchmark('withUnboundedConcurrency cancel cleanup', 'cleanup', CleanupIterations, 50, async () => {
    await cleanupFailureProgram().pipe(withScope(CleanupScope), withUnboundedConcurrency, returnFail, runPromise)
  }),
  benchmark('withCoopConcurrency cancel cleanup', 'cleanup', CleanupIterations, 50, async () => {
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
  iterations: number,
  warmup: number,
  run: () => Promise<void>
): BenchmarkCase {
  return { name, group, iterations, warmup, run }
}

async function runBenchmarks(benchmarks: readonly BenchmarkCase[]): Promise<readonly Result[]> {
  const rawResults: Omit<Result, 'relativeToGroupBaseline'>[] = []

  for (const b of benchmarks) {
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
    race([
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
    '- Command: `pnpm benchmark:cooperative-all`',
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
    '| Case | Iterations | Total ms | Ops/sec | ns/op | Relative to group baseline |',
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
    return execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim() || 'clean'
  } catch {
    return 'unknown'
  }
}
