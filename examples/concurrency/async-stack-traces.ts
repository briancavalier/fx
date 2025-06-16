import { Console, Fail, Fork, Task, flatMap, fx, runPromise, tap } from "../../src"

const f1 = fx(function* () {
  yield* Console.log('f1 start, forking f2')
  const r = yield* Fork.fork(f2).pipe(flatMap(Task.wait))
  yield* Console.log(`f1 finished, f2 result: ${r}`)
  return r
})

const f2 = fx(function* () {
  yield* Console.log('f2 start, forking f3')
  const r = yield* Fork.fork(f3).pipe(flatMap(Task.wait))
  yield* Console.log(`f2 finished, f3 result: ${r}`)
  return r
})

const f3 = fx(function* () {
  yield* Console.log('f3 start, about to fail')
  yield* Fail.fail(new Error('An error occurred in f3'))
  return 42
})

const main = Fork.fork(f1)

main.pipe(
  flatMap(Task.wait),
  tap(result => Console.log(`main finished`, result)),
  Fail.catchAll(error => Console.error('Error!', error)),
  Fork.unbounded,
  Console.defaultConsole,
  runPromise
)
