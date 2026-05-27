import { fail, Fail, fx, returnFail, runPromise } from '@briancavalier/fx'
import { RaceAllFailed, firstSettled, firstSuccess, race, withUnboundedConcurrency } from '@briancavalier/fx/concurrent'

import { defaultTime, sleep } from '@briancavalier/fx/time'
import { formatDiagnostic, formatError, snapshotError } from '@briancavalier/fx/trace'
import { nodeSourceLookup } from '@briancavalier/fx/platform-node'
 
// This example builds one Race request and interprets it with two different
// handlers. `firstSettled` is first-settled, like Promise.race: the fast failure
// wins. `firstSuccess` is first-successful, like Promise.any: the fast failure
// is ignored while another child can still succeed. This shows how fx can keep
// one structured concurrency effect while choosing execution policy by handler.

const fastFailure = fx(function* () {
  yield* sleep(10)
  yield* fail(new Error('primary failed quickly'))
})

const slowSuccess = fx(function* () {
  yield* sleep(40)
  return 'replica succeeded'
})

// Construct a Race effect once. The handler applied later determines how this
// same request is interpreted.
const request = race([fastFailure, slowSuccess])
const sourceLookup = nodeSourceLookup()

const firstSettledResult = await request.pipe(
  // First-settled semantics: the fast failure wins and cancels the slow success.
  firstSettled,
  withUnboundedConcurrency,
  returnFail,
  defaultTime,
  runPromise
)

if (Fail.is(firstSettledResult)) {
  console.log('firstSettled:', 'failed with the first settled child')
  printFailure(firstSettledResult.arg)
} else {
  console.log('firstSettled:', firstSettledResult)
}

const firstOk = await request.pipe(
  // First-success semantics: the fast failure is ignored, so the slower success wins.
  firstSuccess,
  withUnboundedConcurrency,
  returnFail,
  defaultTime,
  runPromise
)

console.log('firstSuccess:', firstOk)

const allFailed = await race([
  fx(function* () {
    yield* fail(new Error('primary failed'))
  }),
  fx(function* () {
    yield* fail(new Error('replica failed'))
  })
]).pipe(
  // If every child fails, firstSuccess fails with input-ordered child errors.
  firstSuccess,
  withUnboundedConcurrency,
  returnFail,
  defaultTime,
  runPromise
)

if (Fail.is(allFailed) && allFailed.arg instanceof RaceAllFailed) {
  console.log('firstSuccess all failed:')
  printFailure(allFailed.arg)
}

function printFailure(failure: unknown): void {
  console.log([
    'Human-readable diagnostic:',
    formatDiagnostic(failure, { source: { lookup: sourceLookup } }),
    '',
    'Short human-readable error:',
    formatError(failure),
    '',
    'Structured diagnostic snapshot:',
    JSON.stringify(snapshotError(failure), null, 2)
  ].join('\n'))
}
