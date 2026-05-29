import { assert as assertNoFail, assertPromise, fx, runPromise } from '@briancavalier/fx'
import { forkIn, withUnboundedConcurrency } from '@briancavalier/fx/concurrent'
import { andFinallyExit, returnFrom, scope, withScope } from '@briancavalier/fx/scope'

/*
 * Temporary prototype example: a race built from scope-owned forks.
 * The first child to returnFrom the Race scope resolves the parent scope,
 * and the losing child is finalized before the program completes.
 */

const Race = scope('examples/experimental/scope-owned-fork-race')

const sleep = (ms: number) => assertPromise<void>(() => new Promise(resolve => setTimeout(resolve, ms)))
const waitForAbort = () => assertPromise<void>(signal => new Promise(resolve => {
  signal.addEventListener('abort', () => resolve(), { once: true })
}))

const program = fx(function* () {
  yield* forkIn(Race, fx(function* () {
    console.log('fast: start')
    yield* sleep(25)
    console.log('fast: returnFrom Race')
    return yield* returnFrom(Race, 'fast result')
  }))

  yield* forkIn(Race, fx(function* () {
    console.log('slow: start')
    yield* andFinallyExit(Race, exit => fx(function* () {
      console.log(`slow: finalized after ${exit.type}`)
    }))
    yield* waitForAbort()
    console.log('slow: unreachable after race completion')
  }))

  console.log('parent: waiting for Race scope')
  return 'parent result'
})

const result = await program.pipe(
  withScope(Race),
  withUnboundedConcurrency,
  assertNoFail,
  runPromise
)

console.log('result:', result)
