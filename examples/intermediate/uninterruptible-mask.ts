import { fx, runPromise } from '@briancavalier/fx'
import { firstSettled, race, unbounded } from '@briancavalier/fx/concurrent'
import { consoleLog, defaultConsole } from '@briancavalier/fx'
import { assert as assertNoFail } from '@briancavalier/fx'
import { andFinallyExit } from '@briancavalier/fx/scope'
import { uninterruptibleMask } from '@briancavalier/fx'
import { scope } from '@briancavalier/fx/scope'
import { defaultTime, sleep } from '@briancavalier/fx/time'

/*
 * `uninterruptibleMask` keeps a short critical section safe from interruption,
 * while `restore` makes the long-running use phase interruptible again.
 *
 * The fast branch wins the race while the slow branch is still acquiring its
 * resource. Interruption is deferred until the acquire/register section
 * completes, so cleanup is registered before the slow branch is interrupted.
 */

const ExampleScope = 'examples/intermediate/uninterruptible-mask' as const

const acquireResource = fx(function* () {
  yield* consoleLog('slow: acquiring resource')
  yield* sleep(250)
  yield* consoleLog('slow: acquired resource')
  return 'connection'
})

const useResource = (resource: string) => fx(function* () {
  yield* consoleLog(`slow: using ${resource}`)
  yield* sleep(1000)
  yield* consoleLog(`slow: done using ${resource}`)
})

const slow = uninterruptibleMask(restore => fx(function* () {
  const resource = yield* acquireResource
  yield* andFinallyExit(ExampleScope, exit => fx(function* () {
    yield* consoleLog(`slow: releasing ${resource} after ${exit.type}`)
    yield* sleep(100)
    yield* consoleLog(`slow: released ${resource}`)
  }))

  yield* restore(useResource(resource))
  return 'slow result'
}))

const fast = fx(function* () {
  yield* consoleLog('fast: starting')
  yield* sleep(50)
  yield* consoleLog('fast: done')
  return 'fast result'
})

const main = fx(function* () {
  const result = yield* race([slow, fast])
  yield* consoleLog('winner:', result)
})

await main.pipe(
  firstSettled,
  scope(ExampleScope),
  defaultTime,
  unbounded,
  defaultConsole,
  assertNoFail,
  runPromise
)
