import { fail, Fail, fx, returnFail, runPromise, wait } from '@briancavalier/fx'
import {
  RaceAllFailed,
  all,
  firstSuccess,
  fork,
  race,
  withBoundedConcurrency,
  withCoopConcurrency,
  withUnboundedConcurrency
} from '@briancavalier/fx/concurrent'

import { defaultTime, sleep } from '@briancavalier/fx/time'
import { formatDiagnostic, formatError, snapshotError } from '@briancavalier/fx/trace'
import { nodeSourceLookup } from '@briancavalier/fx/platform-node'

// This example shows two concurrency choices:
// - `race` and `firstSuccess` are operators with different settlement behavior.
// - `withBoundedConcurrency` and `withCoopConcurrency` are scheduler handlers
//   for one program that uses both `all` and explicit `fork`.

const fastFailure = fx(function* () {
  yield* sleep(10)
  yield* fail(new Error('primary failed quickly'))
})

const slowSuccess = fx(function* () {
  yield* sleep(40)
  return 'replica succeeded'
})

const request = race([fastFailure, slowSuccess])
const sourceLookup = nodeSourceLookup()

console.log('\nconcurrency operators')

const raceResult = await request.pipe(
  // First-settled semantics: the fast failure wins and cancels the slow success.
  withUnboundedConcurrency,
  returnFail,
  defaultTime,
  runPromise
)

if (Fail.is(raceResult)) {
  console.log('race:', 'failed with the first settled child')
  printFailure(raceResult.arg)
} else {
  console.log('race:', raceResult)
}

const firstOk = await firstSuccess([fastFailure, slowSuccess]).pipe(
  // First-success semantics: the fast failure is ignored, so the slower success wins.
  withUnboundedConcurrency,
  returnFail,
  defaultTime,
  runPromise
)

console.log('firstSuccess:', firstOk)

const allFailed = await firstSuccess([
  fx(function* () {
    yield* fail(new Error('primary failed'))
  }),
  fx(function* () {
    yield* fail(new Error('replica failed'))
  })
]).pipe(
  // If every child fails, firstSuccess fails with input-ordered child errors.
  withUnboundedConcurrency,
  returnFail,
  defaultTime,
  runPromise
)

if (Fail.is(allFailed) && allFailed.arg instanceof RaceAllFailed) {
  console.log('firstSuccess all failed:')
  printFailure(allFailed.arg)
}

const loadUser = fx(function* () {
  yield* sleep(20)
  return { id: 'user-123', name: 'Ada' }
})

const loadPosts = fx(function* () {
  yield* sleep(30)
  return ['effects as data', 'handlers as interpreters']
})

const refreshCache = fx(function* () {
  yield* sleep(15)
  return 'cache refreshed'
})

const loadDashboard = fx(function* () {
  const cacheRefresh = yield* fork(refreshCache)
  const [user, posts] = yield* all([loadUser, loadPosts])
  const cache = yield* wait(cacheRefresh)

  return { user, posts, cache }
})

console.log('\nscheduler handlers')

const forkBackedDashboard = await loadDashboard.pipe(
  withBoundedConcurrency(2),
  defaultTime,
  runPromise
)

console.log('withBoundedConcurrency:', forkBackedDashboard)

const cooperativeDashboard = await loadDashboard.pipe(
  withCoopConcurrency({ concurrency: 2, yieldBudget: 64 }),
  defaultTime,
  runPromise
)

console.log('withCoopConcurrency:', cooperativeDashboard)

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
