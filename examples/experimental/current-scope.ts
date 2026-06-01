import { assert as assertNoFail, consoleLog, defaultConsole, fx, ok, run, runPromise } from '@briancavalier/fx'
import { withUnboundedConcurrency } from '@briancavalier/fx/concurrent'
import {
  andFinallyExit,
  collectFrom,
  currentScope,
  recoverInterrupt,
  scoped,
  scope,
  withScope,
  yieldFrom,
  type Yielding
} from '@briancavalier/fx/scope'
import { defaultTime, sleep } from '@briancavalier/fx/time'
import { timeoutIn } from '@briancavalier/fx/timeout'

const NamedRequest = scope('examples/experimental/current-scope/NamedRequest')
const NamedEvents = scope<Yielding<string>>()('examples/experimental/current-scope/NamedEvents')

const named = fx(function* () {
  yield* andFinallyExit(NamedRequest, exit => consoleLog(`named cleanup: ${exit.type}`))
  return 'named request'
}).pipe(
  withScope(NamedRequest),
  defaultConsole,
  assertNoFail,
  run
)

const privateScoped = scoped(fx(function* () {
  yield* andFinallyExit(currentScope, exit => consoleLog(`private cleanup: ${exit.type}`))
  return 'private request'
})).pipe(
  defaultConsole,
  assertNoFail,
  run
)

const externallyHandled = fx(function* () {
  yield* yieldFrom(NamedEvents, 'external event')
  return 'external collected'
}).pipe(
  collectFrom(NamedEvents),
  run
)

const deadline = await fx(function* () {
  yield* timeoutIn(NamedRequest, { ms: 5, label: 'named request deadline' })
  yield* sleep(20)
  return 'finished'
}).pipe(
  withScope(NamedRequest),
  recoverInterrupt(NamedRequest, () => ok('timed out' as const)),
  defaultTime,
  withUnboundedConcurrency,
  assertNoFail,
  runPromise
)

console.log({
  named,
  privateScoped,
  externallyHandled,
  deadline
})
