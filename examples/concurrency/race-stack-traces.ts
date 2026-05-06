import { fx, runPromise } from "../../src"
import { defaultConsole, error, log } from "../../src/Console"
import { catchAll, fail } from "../../src/Fail"
import { defaultRace, race, unbounded } from "../../src/Concurrent"
import { defaultTime, sleep } from "../../src/Time"

const child1 = fx(function* () {
  yield* log('child1 start')
  yield* sleep(10)
  return 'child1 ok'
})

const child2 = fx(function* () {
  yield* log('child2 start, about to fail')
  yield* fail(new Error('child2 failed'))
  return 'unreachable'
})

const child3 = fx(function* () {
  yield* log('child3 start')
  yield* sleep(10)
  return 'child3 ok'
})

await race([child1, child2, child3]).pipe(
  defaultRace,
  catchAll(e => error('Error!', e)),
  unbounded,
  defaultTime,
  defaultConsole,
  runPromise
)
