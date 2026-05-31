import { consoleError, consoleLog, defaultConsole, fx, returnAll, runPromise } from '@briancavalier/fx'
import { withCoopConcurrency } from '@briancavalier/fx/concurrent'

import { withConsoleLog } from '@briancavalier/fx/log'
import { withScope } from '@briancavalier/fx/scope'
import { defaultTime } from '@briancavalier/fx/time'
import {
  BundleScope,
  CollectorScope,
  collectIncidentSnapshot,
  createIncidentCollectorFixture
} from './domain.js'

const runSnapshot = (label: string, failDeploy: boolean) => fx(function* () {
  const fixture = createIncidentCollectorFixture({
    failDeploy,
    primaryRuntimeFails: true
  })

  const result = yield* collectIncidentSnapshot({
    incidentId: failDeploy ? 'INC-2026-05-17-B' : 'INC-2026-05-17-A',
    services: ['api', 'worker', 'billing']
  }).pipe(
    fixture.handle,
    withScope(CollectorScope),
    withConsoleLog,
    defaultTime,
    // Toggle scheduler handlers:
    // fork-backed scheduling:
    // withBoundedConcurrency(6),
    // cooperative scheduling:
    withCoopConcurrency({ concurrency: 6, yieldBudget: 64 }),
    withScope(BundleScope),
    returnAll,
  )

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
).catch(async error => {
  await consoleError(error).pipe(defaultConsole, runPromise)
  process.exitCode = 1
})
