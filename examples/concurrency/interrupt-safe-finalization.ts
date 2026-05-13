import { fx, runPromise } from '../../src'
import { firstSettled, race, unbounded } from '../../src/Concurrent'
import { defaultConsole, log } from '../../src/Console'
import { usingExit } from '../../src/Finalization'
import { scope } from '../../src/Scope'
import { defaultTime, sleep } from '../../src/Time'

/*
 * Interrupt-safe finalization with `race`.
 *
 * The cache branch wins quickly while the database branch is still running.
 * `firstSettled` interrupts the losing database branch and waits for its
 * scoped async finalizer before the program logs the result.
 *
 * The example shows exit-aware cleanup with `usingExit`, named finalization
 * with `scope`, and structured race cancellation.
 */

const RequestScope = 'examples/concurrency/interrupt-safe-finalization' as const

const openConnection = fx(function* () {
  yield* log('database: open connection')
  return 'connection'
})

const fetchFromCache = fx(function* () {
  yield* log('cache: starting')
  yield* sleep(100)
  yield* log('cache: hit')
  return 'cached result'
})

const fetchFromDatabase = fx(function* () {
  const connection = yield* usingExit(
    RequestScope,
    openConnection,
    (_, exit) => fx(function* () {
      yield* log(`database: close connection after ${exit.type}`)
      yield* sleep(250)
      yield* log('database: connection closed')
    })
  )

  yield* log(`database: query with ${connection}`)
  yield* sleep(1000)
  yield* log('database: query complete')
  return 'database result'
})

const main = fx(function* () {
  const result = yield* race([
    fetchFromCache,
    fetchFromDatabase,
  ])

  yield* log('result:', result)
})

await main.pipe(
  firstSettled,
  scope(RequestScope),
  defaultTime,
  unbounded,
  defaultConsole,
  runPromise
)
