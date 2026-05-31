import { assert as assertNoFail, fx, ok, run, runPromise } from '@briancavalier/fx'
import { withUnboundedConcurrency } from '@briancavalier/fx/concurrent'
import {
  andFinallyExit,
  collectFrom,
  collectScoped,
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
  yield* andFinallyExit(NamedRequest, exit => ok(console.log(`named cleanup: ${exit.type}`)))
  return 'named request'
}).pipe(
  withScope(NamedRequest),
  assertNoFail,
  run
)

const privateScoped = scoped(current => fx(function* () {
  yield* andFinallyExit(current, exit => ok(console.log(`private cleanup: ${exit.type}`)))
  return 'private request'
})).pipe(
  assertNoFail,
  run
)

const privateCollected = collectScoped<string>()(current => fx(function* () {
  yield* yieldFrom(current, 'private event')
  return 'private collected'
})).pipe(run)

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
  privateCollected,
  externallyHandled,
  deadline
})
