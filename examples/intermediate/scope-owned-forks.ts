import { assert as assertNoFail, consoleLog, defaultConsole, fx, runPromise } from '@briancavalier/fx'
import { forkIn, withBoundedConcurrency } from '@briancavalier/fx/concurrent'
import { andFinally, currentScope, recoverInterrupt, scope, withScope } from '@briancavalier/fx/scope'
import { defaultTime, sleep } from '@briancavalier/fx/time'
import { timeoutIn } from '@briancavalier/fx/timeout'

const RequestScope = scope('examples/intermediate/scope-owned-forks', {
  label: 'request'
})

const child = (name: string, ms: number) => fx(function* () {
  yield* andFinally(exit =>
    consoleLog(`${name}: cleanup after ${exit.type}`)
  )

  yield* consoleLog(`${name}: start`)
  yield* sleep(ms)
  yield* consoleLog(`${name}: complete`)
  return name
})

const request = fx(function* () {
  yield* timeoutIn(currentScope, { ms: 35, label: 'request deadline' })
  yield* forkIn(currentScope, child('fast-cache-refresh', 20))
  yield* forkIn(currentScope, child('slow-profile-load', 80))
  yield* consoleLog('request: children forked')
  return 'accepted'
})

const result = await request.pipe(
  withScope(RequestScope),
  recoverInterrupt(RequestScope, reason => fx(function* () {
    yield* consoleLog(`request: interrupted by ${formatReason(reason)}`)
    return 'timed out' as const
  })),
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
