import { assert as assertNoFail, consoleLog, defaultConsole, fx, runPromise } from '@briancavalier/fx'
import { forkIn, withBoundedConcurrency } from '@briancavalier/fx/concurrent'
import { andFinallyIn, recoverInterrupt, inScope, withScope, type AnyLifetimeScope } from '@briancavalier/fx/scope'
import { defaultTime, sleep } from '@briancavalier/fx/time'
import { timeoutIn } from '@briancavalier/fx/timeout'

const child = <const S extends AnyLifetimeScope>(requestScope: S, name: string, ms: number) => fx(function* () {
  yield* andFinallyIn(requestScope, exit =>
    consoleLog(`${name}: cleanup after ${exit.type}`)
  )

  yield* consoleLog(`${name}: start`)
  yield* sleep(ms)
  yield* consoleLog(`${name}: complete`)
  return name
})

const request = <const S extends AnyLifetimeScope>(requestScope: S) => fx(function* () {
  yield* timeoutIn(requestScope, { ms: 35, label: 'request deadline' })
  yield* forkIn(requestScope, child(requestScope, 'fast-cache-refresh', 20))
  yield* forkIn(requestScope, child(requestScope, 'slow-profile-load', 80))
  yield* consoleLog('request: children forked')
  return 'accepted'
})

const result = await withScope({ label: 'request' }, requestScope => inScope(requestScope, request(requestScope).pipe(
  recoverInterrupt(requestScope, reason => fx(function* () {
    yield* consoleLog(`request: interrupted by ${formatReason(reason)}`)
    return 'timed out' as const
  }))
))).pipe(
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
