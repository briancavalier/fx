import { flatMap, fx, runPromise, tap } from "../../src"
import { catchAll, fail } from "../../src/Fail"
import { defaultConsole, error, log } from "../../src/Console"
import { fork, unbounded } from "../../src/Concurrent"
import { wait } from "../../src/Task"
import { formatError } from "../../src/Trace"

const f1 = fx(function* () {
  yield* log('f1 start, forking f2')
  const r = yield* fork(f2).pipe(flatMap(wait))
  yield* log(`f1 finished, f2 result: ${r}`)
  return r
})

const f2 = fx(function* () {
  yield* log('f2 start, forking f3')
  const r = yield* fork(f3).pipe(flatMap(wait))
  yield* log(`f2 finished, f3 result: ${r}`)
  return r
})

const f3 = fx(function* () {
  yield* log('f3 start, about to fail')
  yield* fail(new Error('An error occurred in f3'))
  return 42
})

const main = fork(f1)

await main.pipe(
  flatMap(wait),
  tap(result => log(`main finished`, result)),
  catchAll(errorWithTrace),
  unbounded,
  defaultConsole,
  runPromise
)

function errorWithTrace(e: unknown) {
  return error(formatError(e))
}
