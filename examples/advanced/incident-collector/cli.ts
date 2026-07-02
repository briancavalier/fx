import { consoleError, consoleLog, defaultConsole, fx, returnAll, runPromise, type Async, type Fx, type HandlerCapture, type Interrupt } from '@briancavalier/fx'
import { withCoopConcurrency } from '@briancavalier/fx/concurrent'

import { withConsoleLog } from '@briancavalier/fx/log'
import { inScope, withScope } from '@briancavalier/fx/scope'
import { defaultTime } from '@briancavalier/fx/time'
import {
  collectIncidentSnapshot,
  createIncidentCollectorFixture
} from './domain.js'

const runSnapshot = (label: string, failDeploy: boolean) => fx(function* () {
  const fixture = createIncidentCollectorFixture({
    failDeploy,
    primaryRuntimeFails: true
  })

  const result = yield* (withScope({ label: 'bundle' }, bundleScope => inScope(bundleScope, fx(function* () {
    return yield* withScope({ label: 'collector' }, collectorScope => inScope(collectorScope, collectIncidentSnapshot(bundleScope, collectorScope, {
      incidentId: failDeploy ? 'INC-2026-05-17-B' : 'INC-2026-05-17-A',
      services: ['api', 'worker', 'billing']
    }).pipe(
      fixture.handle,
      // Toggle scheduler handlers:
      // fork-backed scheduling:
      // withBoundedConcurrency(6),
      // cooperative scheduling:
      withCoopConcurrency({ concurrency: 6, yieldBudget: 64 })
    )) as Fx<unknown, unknown>)
  }))).pipe(
    withConsoleLog,
    defaultTime,
    returnAll
  ) as Fx<Async | HandlerCapture<string> | Interrupt, unknown>)

  yield* consoleLog(`\n${label}`)
  yield* consoleLog(JSON.stringify({ result: printableResult(result), state: fixture.state() }, null, 2))
})

const printableResult = (result: unknown): unknown =>
  result instanceof Error
    ? {
      error: result.message,
      cause: result.cause
    }
    : result

await fx(function* () {
  yield* runSnapshot('successful snapshot', false)
  yield* runSnapshot('failing collector fails while siblings are interrupted', true)
}).pipe(
  defaultConsole,
  runPromise
).catch(async (error: unknown) => {
  await consoleError(error).pipe(defaultConsole, runPromise)
  process.exitCode = 1
})
