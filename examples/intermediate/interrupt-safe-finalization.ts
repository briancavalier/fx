import { fx, runPromise } from '@briancavalier/fx'
import { firstSettled, race, unbounded } from '@briancavalier/fx/concurrent'
import { consoleLog, defaultConsole } from '@briancavalier/fx'
import { assert as assertNoFail } from '@briancavalier/fx'
import { usingExit } from '@briancavalier/fx/scope'
import { scope } from '@briancavalier/fx/scope'
import { defaultTime, sleep } from '@briancavalier/fx/time'

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

const RequestScope = 'examples/intermediate/interrupt-safe-finalization' as const

const openConnection = fx(function* () {
  yield* consoleLog('database: open connection')
  return 'connection'
})

const fetchFromCache = fx(function* () {
  yield* consoleLog('cache: starting')
  yield* sleep(100)
  yield* consoleLog('cache: hit')
  return 'cached result'
})

const fetchFromDatabase = fx(function* () {
  const connection = yield* usingExit(
    RequestScope,
    openConnection,
    (_, exit) => fx(function* () {
      yield* consoleLog(`database: close connection after ${exit.type}`)
      yield* sleep(250)
      yield* consoleLog('database: connection closed')
    })
  )

  yield* consoleLog(`database: query with ${connection}`)
  yield* sleep(1000)
  yield* consoleLog('database: query complete')
  return 'database result'
})

const main = fx(function* () {
  const result = yield* race([
    fetchFromCache,
    fetchFromDatabase,
  ])

  yield* consoleLog('result:', result)
})

await main.pipe(
  firstSettled,
  scope(RequestScope),
  defaultTime,
  unbounded,
  defaultConsole,
  assertNoFail,
  runPromise
)
