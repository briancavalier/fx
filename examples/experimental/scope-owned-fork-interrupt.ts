import { assert as assertNoFail, assertPromise, fx, runPromise } from '@briancavalier/fx'
import { forkIn, withUnboundedConcurrency } from '@briancavalier/fx/concurrent'
import { andFinallyExit, interruptFrom, recoverInterrupt, scope, withScope } from '@briancavalier/fx/scope'

/*
 * Temporary prototype example: named Scope owns fork lifetime, while the
 * concurrency handler owns scheduling.
 */

const Workers = scope('examples/experimental/scope-owned-fork-interrupt')

const sleep = (ms: number) => assertPromise<void>(() => new Promise(resolve => setTimeout(resolve, ms)))

const waitForAbort = () => assertPromise<void>(signal => new Promise(resolve => {
  signal.addEventListener('abort', () => resolve(), { once: true })
}))

const worker = (name: string) => fx(function* () {
  console.log(`${name}: start`)
  yield* andFinallyExit(Workers, exit => fx(function* () {
    console.log(`${name}: finalized after ${exit.type}`)
  }))
  yield* waitForAbort()
  console.log(`${name}: unreachable after scope interruption`)
})

const program = fx(function* () {
  yield* forkIn(Workers, worker('worker-a'))
  yield* forkIn(Workers, worker('worker-b'))

  yield* sleep(25)
  console.log('parent: interrupting Workers scope')
  yield* interruptFrom(Workers, 'shutdown')
})

const result = await program.pipe(
  withScope(Workers),
  recoverInterrupt(Workers, reason => fx(function* () {
    console.log(`parent: recovered ${String(reason)}`)
    return reason
  })),
  withUnboundedConcurrency,
  assertNoFail,
  runPromise
)

console.log('result:', result)
