import { execFileSync } from 'node:child_process'
import { arch, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'

import { assertPromise } from '../src/Async.js'
import { all, withBoundedConcurrency, fork, race, withUnboundedConcurrency } from '../src/Concurrent.js'
import { Effect } from '../src/Effect.js'
import { andFinallyIn } from '../src/Finalization.js'
import { fx, ok, run, runPromise, runTask } from '../src/Fx.js'
import { control, handle } from '../src/Handler.js'
import { captureHandlers, closeHandlerCapture, mapCapturedHandlers, withHandlerContext } from '../src/HandlerCapture.js'
import { uninterruptible } from '../src/Interrupt.js'
import { scope, withScope } from '../src/Scope.js'
import { wait } from '../src/Task.js'
import { setTraceCapturePolicy } from '../src/Trace.js'
import { Handler as InternalHandler } from '../src/internal/Handler.js'
import type { TraceCapturePolicy } from '../src/Trace.js'
import type { Fx } from '../src/Fx.js'

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

class Ping extends Effect('benchmark/runtime-loops/Ping')<number, number> { }
class Target extends Effect('benchmark/runtime-loops/Target')<number, number> { }
class Miss extends Effect('benchmark/runtime-loops/Miss')<number, number> { }

const HandlerIterations = 20_000
const CaptureIterations = 20_000
const RunForkIterations = 2_000
const InterruptIterations = 1_000
const EffectsPerProgram = 100
const InterruptScope = scope('benchmark/runtime-loops/Interrupt')
const ScopeFinalizer = scope('benchmark/runtime-loops/ScopeFinalizer')

const pingHandler = handle(Ping, ping => ok(ping.arg + 1))
const targetHandler = handle(Target, target => ok(target.arg + 1))
const missHandler = handle(Miss, miss => ok(miss.arg + 1))
const controlResume = control(Ping, (resume, ping) => ok(resume(ping.arg + 1)))
const controlShortCircuit = control(Ping, (_, ping) => ok(ping.arg + 1))
const controlMiss = control(Miss, (resume, miss) => ok(resume(miss.arg + 1)))
const directPingHandler = internalHandler(Ping, ping => ok(ping.arg + 1))
const directTargetHandler = internalHandler(Target, target => ok(target.arg + 1))
const directMissHandler = internalHandler(Miss, miss => ok(miss.arg + 1))

const pingProgram = effectProgram(Ping, EffectsPerProgram)
const targetProgram = effectProgram(Target, EffectsPerProgram)
const prebuiltMatchedHandlerProgram = pingProgram.pipe(pingHandler)
const directMatchedHandlerProgram = pingProgram.pipe(directPingHandler)
const pureRunPromise = ok(1)
const sequentialAsync10 = asyncProgram(10)
const forkFanout16 = forkFanout(16)
const allFanout16 = all(fanoutValues(16))
const raceFanout16 = race(fanoutValues(16))
const blocked = assertPromise<void>(() => new Promise(() => { }))
const blockedWithFinalizer = fx(function* () {
  yield* andFinallyIn(InterruptScope, ok(undefined))
  return yield* blocked
}).pipe(withScope(InterruptScope))

const handlerContextDepths = [0, 1, 4, 8, 16] as const
const captureFanouts = [1, 4, 16, 64] as const
const forkBounds = [1, 4, 16] as const
const scopePassThroughPrograms = new Map<number, Fx<any, any>>(
  handlerContextDepths.map(depth => [depth, applyScopes(targetProgram, depth).pipe(targetHandler)])
)
const handlerCaptureBoundaryPassThroughPrograms = new Map<number, Fx<any, any>>(
  handlerContextDepths.map(depth => [depth, applyHandlerCaptureBoundaries(targetProgram, 'other', depth).pipe(targetHandler)])
)
const controlPassThroughPrograms = new Map<number, Fx<any, any>>(
  handlerContextDepths.map(depth => [depth, applyControls(targetProgram, depth).pipe(targetHandler)])
)

const capturedContexts = new Map<number, ReturnType<typeof captureContext>>(
  handlerContextDepths.map(depth => [depth, captureContext(depth)])
)
const replayProgram = effectProgram(Ping, EffectsPerProgram).pipe(pingHandler)
const interruptMaskProgram = maskProgram(EffectsPerProgram)
const prebuiltPassThroughPrograms = new Map<number, Fx<any, any>>(
  handlerContextDepths.map(depth => [depth, applyHandlers(targetProgram, handlerStack(depth))])
)
const directPassThroughPrograms = new Map<number, Fx<any, any>>(
  handlerContextDepths.map(depth => [depth, applyHandlers(targetProgram, directHandlerStack(depth))])
)
let constructionSink: Fx<any, any> | undefined

const cases: readonly BenchmarkCase[] = [
  benchmark('matched handler throughput', 'handler', HandlerIterations, 500, () => {
    pingProgram.pipe(pingHandler, run)
  }),
  benchmark('prebuilt matched handler throughput', 'handler', HandlerIterations, 500, () => {
    prebuiltMatchedHandlerProgram.pipe(run)
  }),
  benchmark('direct internal matched handler throughput', 'handler', HandlerIterations, 500, () => {
    directMatchedHandlerProgram.pipe(run)
  }),
  ...handlerContextDepths.map(depth =>
    benchmark(`pass-through depth ${depth}`, 'handler', HandlerIterations, 500, () => {
      applyHandlers(targetProgram, handlerStack(depth)).pipe(run)
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`prebuilt pass-through depth ${depth}`, 'handler', HandlerIterations, 500, () => {
      prebuiltPassThroughPrograms.get(depth)!.pipe(run)
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`direct internal pass-through depth ${depth}`, 'handler', HandlerIterations, 500, () => {
      directPassThroughPrograms.get(depth)!.pipe(run)
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`construct handler stack depth ${depth}`, 'handler', HandlerIterations, 500, () => {
      constructionSink = applyHandlers(targetProgram, handlerStack(depth))
    })
  ),
  benchmark('matched handler outermost', 'handler', HandlerIterations, 500, () => {
    applyHandlers(targetProgram, [targetHandler, missHandler, missHandler, missHandler]).pipe(run)
  }),
  benchmark('matched handler middle', 'handler', HandlerIterations, 500, () => {
    applyHandlers(targetProgram, [missHandler, missHandler, targetHandler, missHandler]).pipe(run)
  }),
  benchmark('matched handler innermost', 'handler', HandlerIterations, 500, () => {
    applyHandlers(targetProgram, [missHandler, missHandler, missHandler, targetHandler]).pipe(run)
  }),
  benchmark('control resume', 'handler', HandlerIterations, 500, () => {
    pingProgram.pipe(controlResume, run)
  }),
  benchmark('control short-circuit', 'handler', HandlerIterations, 500, () => {
    pingProgram.pipe(controlShortCircuit, run)
  }),
  ...handlerContextDepths.map(depth =>
    benchmark(`control pass-through depth ${depth}`, 'handler', HandlerIterations, 500, () => {
      controlPassThroughPrograms.get(depth)!.pipe(run)
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`capture depth ${depth}`, 'capture', CaptureIterations, 500, () => {
      captureContext(depth)
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`replay depth ${depth}`, 'capture', CaptureIterations, 500, () => {
      withHandlerContext(capturedContexts.get(depth)!, replayProgram).pipe(run)
    })
  ),
  ...captureFanouts.map(fanout =>
    benchmark(`mapCapturedHandlers fanout ${fanout}`, 'capture', CaptureIterations, 500, () => {
      mapCapturedHandlers('benchmark/runtime-loops/Capture', fanoutValues(fanout)).pipe(
        closeHandlerCapture('benchmark/runtime-loops/Capture'),
        run
      )
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`scope pass-through depth ${depth}`, 'scope', HandlerIterations, 500, () => {
      scopePassThroughPrograms.get(depth)!.pipe(run)
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`scope finalizer registration depth ${depth}`, 'scope', CaptureIterations, 500, () => {
      finalizerProgram(depth).pipe(withScope(ScopeFinalizer), run)
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`scope capture depth ${depth}`, 'scope', CaptureIterations, 500, () => {
      captureHandlers('benchmark/runtime-loops/ScopeCapture').pipe(
        f => applyScopes(f, depth),
        closeHandlerCapture('benchmark/runtime-loops/ScopeCapture'),
        run
      )
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`handler capture boundary pass-through depth ${depth}`, 'captureBoundary', HandlerIterations, 500, () => {
      handlerCaptureBoundaryPassThroughPrograms.get(depth)!.pipe(run)
    })
  ),
  ...handlerContextDepths.map(depth =>
    benchmark(`handler capture boundary close depth ${depth}`, 'captureBoundary', CaptureIterations, 500, () => {
      captureHandlers('benchmark/runtime-loops/BoundaryCapture').pipe(
        f => applyHandlerCaptureBoundaries(f, 'other', depth),
        closeHandlerCapture('benchmark/runtime-loops/BoundaryCapture'),
        run
      )
    })
  ),
  benchmark('run interrupt mask x100', 'run', HandlerIterations, 500, () => {
    interruptMaskProgram.pipe(run)
  }),
  benchmark('pure runPromise', 'runFork', RunForkIterations, 100, async () => {
    await runPromise(pureRunPromise)
  }),
  benchmark('sequential async x10', 'runFork', RunForkIterations, 100, async () => {
    await runPromise(sequentialAsync10)
  }),
  benchmark('fork fanout 16 withUnboundedConcurrency', 'runFork', RunForkIterations, 100, async () => {
    await forkFanout16.pipe(withUnboundedConcurrency, runPromise)
  }),
  ...forkBounds.map(limit =>
    benchmark(`fork fanout 16 withBoundedConcurrency ${limit}`, 'runFork', RunForkIterations, 100, async () => {
      await forkFanout16.pipe(withBoundedConcurrency(limit), runPromise)
    })
  ),
  benchmark('all fanout 16', 'runFork', RunForkIterations, 100, async () => {
    await allFanout16.pipe(withUnboundedConcurrency, runPromise)
  }),
  benchmark('race fanout 16', 'runFork', RunForkIterations, 100, async () => {
    await raceFanout16.pipe(withUnboundedConcurrency, runPromise)
  }),
  benchmark('dispose blocked task', 'interrupt', InterruptIterations, 100, async () => {
    await disposeTask(blocked)
  }),
  benchmark('dispose blocked scoped task', 'interrupt', InterruptIterations, 100, async () => {
    await disposeTask(blockedWithFinalizer)
  }),
  benchmark('dispose blocked fork', 'interrupt', InterruptIterations, 100, async () => {
    await fx(function* () {
      const task = yield* fork(blocked)
      yield* assertPromise(() => task.interrupt())
    }).pipe(withUnboundedConcurrency, runPromise)
  })
]

const results = await runBenchmarks(cases)
void constructionSink
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
    '# Fx Runtime Loop Benchmark Results',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Git SHA: ${gitSha()}`,
    `- Worktree: ${worktreeState()}`,
    `- Node: ${process.version}`,
    `- Platform: ${platform()} ${release()} ${arch()}`,
    '- Command: `pnpm benchmark:runtime-loops`',
    `- Handler programs yield ${EffectsPerProgram.toLocaleString()} effects per operation.`,
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

function effectProgram<const T extends typeof Ping | typeof Target>(
  EffectType: T,
  count: number
) {
  return fx(function* () {
    let n = 0
    for (let i = 0; i < count; i++) {
      n = yield* new EffectType(n)
    }
    return n
  })
}

function asyncProgram(count: number) {
  return fx(function* () {
    let n = 0
    for (let i = 0; i < count; i++) {
      n = yield* assertPromise(() => Promise.resolve(n + 1))
    }
    return n
  })
}

function maskProgram(count: number) {
  return fx(function* () {
    for (let i = 0; i < count; i++) {
      yield* uninterruptible(ok(i))
    }
  })
}

function fanoutValues(count: number): readonly Fx<never, number>[] {
  return Array.from({ length: count }, (_, i) => ok(i))
}

function handlerStack(depth: number) {
  return [...Array.from({ length: depth }, () => missHandler), targetHandler]
}

function directHandlerStack(depth: number) {
  return [...Array.from({ length: depth }, () => directMissHandler), directTargetHandler]
}

function applyScopes(f: Fx<unknown, unknown>, depth: number) {
  let current = f as Fx<any, any>
  for (let i = 0; i < depth; i++) current = current.pipe(withScope(scope(`benchmark/runtime-loops/Scope/${i}`)))
  return current as Fx<any, any>
}

function finalizerProgram(count: number) {
  return fx(function* () {
    for (let i = 0; i < count; i++) {
      yield* andFinallyIn(ScopeFinalizer, ok(undefined))
    }
  })
}

function applyHandlerCaptureBoundaries(f: Fx<unknown, unknown>, name: string, depth: number) {
  let current = f as Fx<any, any>
  for (let i = 0; i < depth; i++) current = current.pipe(closeHandlerCapture(`${name}/${i}`))
  return current as Fx<any, any>
}

function applyControls(f: Fx<unknown, unknown>, depth: number) {
  let current = f as Fx<any, any>
  for (let i = 0; i < depth; i++) current = current.pipe(controlMiss)
  return current as Fx<any, any>
}

function internalHandler<T extends typeof Ping | typeof Target | typeof Miss>(
  EffectType: T,
  handler: (effect: InstanceType<T>) => Fx<unknown, InstanceType<T>['R']>
) {
  return <E, A>(fx: Fx<E, A>) => new InternalHandler(fx, EffectType._fxEffectId, handler)
}

function forkFanout(count: number) {
  const values = fanoutValues(count)
  return fx(function* () {
    const tasks = []
    for (const value of values) tasks.push(yield* fork(value))
    for (const task of tasks) yield* wait(task)
  })
}

function captureContext(depth: number) {
  return applyHandlers(
    captureHandlers('benchmark/runtime-loops/Capture').pipe(closeHandlerCapture('benchmark/runtime-loops/Capture')),
    Array.from({ length: depth }, () => pingHandler)
  ).pipe(run)
}

function applyHandlers(f: Fx<unknown, unknown>, handlers: readonly ((fx: Fx<any, any>) => Fx<any, any>)[]) {
  let current = f as Fx<any, any>
  for (const handler of handlers) current = current.pipe(handler)
  return current as Fx<any, any>
}

async function disposeTask(f: Fx<any, unknown>) {
  const task = runTask(f)
  await task.interrupt()
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
