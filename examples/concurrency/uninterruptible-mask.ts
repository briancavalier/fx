import { fx, runPromise } from '../../src'
import { firstSettled, race, unbounded } from '../../src/Concurrent'
import { defaultConsole, log } from '../../src/Console'
import { andFinallyExit } from '../../src/Finalization'
import { uninterruptibleMask } from '../../src/Interrupt'
import { scope } from '../../src/Scope'
import { defaultTime, sleep } from '../../src/Time'

/*
 * `uninterruptibleMask` keeps a short critical section safe from interruption,
 * while `restore` makes the long-running use phase interruptible again.
 *
 * The fast branch wins the race while the slow branch is still acquiring its
 * resource. Interruption is deferred until the acquire/register section
 * completes, so cleanup is registered before the slow branch is interrupted.
 */

const ExampleScope = 'examples/concurrency/uninterruptible-mask' as const

const acquireResource = fx(function* () {
  yield* log('slow: acquiring resource')
  yield* sleep(250)
  yield* log('slow: acquired resource')
  return 'connection'
})

const useResource = (resource: string) => fx(function* () {
  yield* log(`slow: using ${resource}`)
  yield* sleep(1000)
  yield* log(`slow: done using ${resource}`)
})

const slow = uninterruptibleMask(restore => fx(function* () {
  const resource = yield* acquireResource
  yield* andFinallyExit(ExampleScope, exit => fx(function* () {
    yield* log(`slow: releasing ${resource} after ${exit.type}`)
    yield* sleep(100)
    yield* log(`slow: released ${resource}`)
  }))

  yield* restore(useResource(resource))
  return 'slow result'
}))

const fast = fx(function* () {
  yield* log('fast: starting')
  yield* sleep(50)
  yield* log('fast: done')
  return 'fast result'
})

const main = fx(function* () {
  const result = yield* race([slow, fast])
  yield* log('winner:', result)
})

await main.pipe(
  firstSettled,
  scope(ExampleScope),
  defaultTime,
  unbounded,
  defaultConsole,
  runPromise
)
