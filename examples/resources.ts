import { nodeSourceLookup } from "../src/TraceNode"
import { formatDiagnostic, fx, runPromise } from "../src"
import { all, defaultAll, unbounded } from "../src/Concurrent"
import { defaultConsole, error, log } from "../src/Console"
import { catchAll, fail } from "../src/Fail"
import { managed, usingManaged } from "../src/Finalization"
import { scope } from "../src/Scope"
import { defaultTime, sleep } from "../src/Time"

/*
 * Resource safety with structured concurrency.
 *
 * Two jobs run with `all`. One job fails while the other is still sleeping, so
 * `defaultAll` interrupts the slow sibling. Both jobs acquire managed resources
 * in the same named `scope`, and each resource has an async finalizer.
 *
 * The output shows both exit paths: the failing job releases after `failure`,
 * while the slow sibling releases after `interrupted`.
 */

const Resources = 'examples/resources' as const

const myResource = (name: string) => fx(function* () {
  yield* sleep(100)
  return managed(
    name,
    exit => fx(function* () {
      yield* log(`releasing resource: ${name} after ${exit.type}`)
      yield* sleep(250)
      yield* log(`released resource: ${name}`)
    })
  )
})

const failingJob = fx(function* () {
  const resource = yield* usingManaged(Resources, myResource('failing-job-resource'))

  yield* log(`using resource: ${resource}`)

  yield* sleep(250)
  yield* fail(new Error('Simulated failure'))

  yield* log(`done using resource: ${resource}`)
})

const slowJob = fx(function* () {
  const resource = yield* usingManaged(Resources, myResource('slow-job-resource'))

  yield* log(`using resource: ${resource}`)

  yield* sleep(2000)
  yield* log(`done using resource: ${resource}`)
})

await all([failingJob, slowJob]).pipe(
  defaultAll,
  scope(Resources),
  defaultTime,
  unbounded,
  catchAll(e => error('failed', formatDiagnostic(e, { source: { lookup: nodeSourceLookup() } }))),
  defaultConsole,
  runPromise
)
