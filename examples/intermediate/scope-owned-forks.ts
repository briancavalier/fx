import { assert as assertNoFail, consoleLog, defaultConsole, fx, runPromise } from '@briancavalier/fx'
import { forkIn, withBoundedConcurrency } from '@briancavalier/fx/concurrent'
import { andFinally, recoverInterrupt, withScope, type AnyLifetimeScope } from '@briancavalier/fx/scope'
import { defaultTime, sleep } from '@briancavalier/fx/time'
import { timeoutIn } from '@briancavalier/fx/timeout'

const child = (name: string, ms: number) => fx(function* () {
  yield* andFinally(exit =>
    consoleLog(`${name}: cleanup after ${exit.type}`)
  )

  yield* consoleLog(`${name}: start`)
  yield* sleep(ms)
  yield* consoleLog(`${name}: complete`)
  return name
})

const request = (requestScope: AnyLifetimeScope) => fx(function* () {
  yield* timeoutIn(requestScope, { ms: 35, label: 'request deadline' })
  yield* forkIn(requestScope, child('fast-cache-refresh', 20))
  yield* forkIn(requestScope, child('slow-profile-load', 80))
  yield* consoleLog('request: children forked')
  return 'accepted'
})

const result = await withScope({ label: 'request' }, requestScope => request(requestScope).pipe(
  recoverInterrupt(requestScope, reason => fx(function* () {
    yield* consoleLog(`request: interrupted by ${formatReason(reason)}`)
    return 'timed out' as const
  }))
)).pipe(
  defaultTime,
  withBoundedConcurrency(2),
  defaultConsole,
  assertNoFail,
  runPromise
)

console.log('result:', result)

function formatReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
