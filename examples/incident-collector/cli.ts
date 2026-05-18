import { bounded, defaultAll, firstSuccess } from '../../src/Concurrent.js'
import { defaultConsole, error as consoleError, log } from '../../src/Console.js'
import { returnAll } from '../../src/Fail.js'
import { fx, runPromise } from '../../src/Fx.js'
import { console as logConsole } from '../../src/Log.js'
import { scope } from '../../src/Scope.js'
import { defaultTime } from '../../src/Time.js'
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
    scope(CollectorScope),
    fixture.handle,
    logConsole,
    defaultTime,
    firstSuccess,
    defaultAll,
    bounded(6),
    scope(BundleScope),
    returnAll,
  )

  yield* log(`\n${label}`)
  yield* log(JSON.stringify({ result: printableResult(result), state: fixture.state() }, null, 2))
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
  yield* runSnapshot('failing snapshot interrupts collectors and fails bundle', true)
}).pipe(
  defaultConsole,
  runPromise
).catch(async error => {
  await consoleError(error).pipe(defaultConsole, runPromise)
  process.exitCode = 1
})
