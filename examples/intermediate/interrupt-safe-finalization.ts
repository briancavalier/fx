import { assert as assertNoFail, consoleLog, defaultConsole, fx, runPromise } from '@briancavalier/fx'
import { race, withUnboundedConcurrency } from '@briancavalier/fx/concurrent'

import { withScope, usingIn, type AnyLifetimeScope } from '@briancavalier/fx/scope'

import { defaultTime, sleep } from '@briancavalier/fx/time'

/*
 * Interrupt-safe finalization with `race`.
 *
 * The cache branch wins quickly while the database branch is still running.
 * `race` interrupts the losing database branch and waits for its
 * scoped async finalizer before the program logs the result.
 *
 * The example shows exit-aware cleanup with `usingIn`, a lexical scope handle,
 * and structured race cancellation.
 */

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

const fetchFromDatabase = (requestScope: AnyLifetimeScope) => fx(function* () {
  const connection = yield* usingIn(
    requestScope,
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

const main = (requestScope: AnyLifetimeScope) => fx(function* () {
  const result = yield* race([
    fetchFromCache,
    fetchFromDatabase(requestScope),
  ])

  yield* consoleLog('result:', result)
})

await withScope({ label: 'interrupt-safe finalization' }, requestScope => main(requestScope)).pipe(
  defaultTime,
  withUnboundedConcurrency,
  defaultConsole,
  assertNoFail,
  runPromise
)
