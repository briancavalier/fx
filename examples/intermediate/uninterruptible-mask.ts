import { assert as assertNoFail, consoleLog, control, defaultConsole, fx, runPromise, uninterruptibleMask } from '@briancavalier/fx'
import { withUnboundedConcurrency } from '@briancavalier/fx/concurrent'

import { andFinallyExit, InterruptFrom, scope, withScope } from '@briancavalier/fx/scope'

import { defaultTime, sleep } from '@briancavalier/fx/time'
import { timeout } from '@briancavalier/fx/timeout'

/*
 * `uninterruptibleMask` keeps a short critical section safe from interruption,
 * while `restore` makes the long-running use phase interruptible again.
 *
 * The timeout fires while the slow operation is still acquiring its resource.
 * Interruption is deferred until the acquire/register section completes, so
 * cleanup is registered before the slow operation is interrupted.
 */

const ExampleScope = scope('examples/intermediate/uninterruptible-mask')

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
    const reason = exit.type === 'interrupted' && exit.reason instanceof Error
      ? ` (${exit.reason.message})`
      : ''
    yield* consoleLog(`slow: releasing ${resource} after ${exit.type}${reason}`)
    yield* sleep(100)
    yield* consoleLog(`slow: released ${resource}`)
  }))

  yield* restore(useResource(resource))
  return 'slow result'
}))

const main = fx(function* () {
  const result = yield* slow.pipe(
    timeout(ExampleScope, { ms: 50 })
  )
  yield* consoleLog('result:', result)
})

await main.pipe(
  withScope(ExampleScope),
  control(InterruptFrom, () => fx(function* () {
    yield* consoleLog('result: timed out')
  })),
  defaultTime,
  withUnboundedConcurrency,
  defaultConsole,
  assertNoFail,
  runPromise
)
