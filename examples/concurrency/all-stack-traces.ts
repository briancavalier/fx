import { flatMap, fx, runPromise } from "../../src"
import { defaultConsole, error, log } from "../../src/Console"
import { catchAll, fail } from "../../src/Fail"
import { all, unbounded } from "../../src/Fork"
import { wait } from "../../src/Task"

const child1 = fx(function* () {
  yield* log('child1 start')
  return 'child1 ok'
})

const child2 = fx(function* () {
  yield* log('child2 start, about to fail')
  yield* fail(new Error('child2 failed'))
  return 'unreachable'
})

const child3 = fx(function* () {
  yield* log('child3 start')
  return 'child3 ok'
})

await all([child1, child2, child3]).pipe(
  flatMap(wait),
  catchAll(e => error('Error!', e)),
  unbounded,
  defaultConsole,
  runPromise
)
