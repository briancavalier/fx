import { fx, runPromise } from '../../src'
import { RaceAllFailed, firstSettled, firstSuccess, race, unbounded } from '../../src/Concurrent'
import { Fail, fail, returnFail } from '../../src/Fail'
import { sleep, defaultTime } from '../../src/Time'

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

const firstSettledResult = await request.pipe(
  // First-settled semantics: the fast failure wins and cancels the slow success.
  firstSettled,
  returnFail,
  unbounded,
  defaultTime,
  runPromise
)

if (Fail.is(firstSettledResult)) {
  console.log('firstSettled:', 'failed with the first settled child')
  console.log('firstSettled cause:', failureMessage(firstSettledResult.arg))
} else {
  console.log('firstSettled:', firstSettledResult)
}

const firstOk = await request.pipe(
  // First-success semantics: the fast failure is ignored, so the slower success wins.
  firstSuccess,
  returnFail,
  unbounded,
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
  returnFail,
  unbounded,
  defaultTime,
  runPromise
)

if (Fail.is(allFailed) && allFailed.arg instanceof RaceAllFailed) {
  console.log('firstSuccess all failed:', allFailed.arg.errors.map((error, index) => ({
    index,
    message: failureMessage(error)
  })))
}

function failureMessage(failure: unknown): string {
  const cause = failure instanceof Error ? failure.cause : undefined
  return cause instanceof Error ? cause.message
    : failure instanceof Error ? failure.message
      : String(failure)
}
