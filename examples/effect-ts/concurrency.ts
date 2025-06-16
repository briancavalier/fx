import { Console, Fork, Task, Time, flatMap, fx, runPromise } from "../../src"

const getUser = (id: number) => fx(function* () {
  yield* Time.sleep(1000) // Simulate a delay
  return { id, name: `User ${id}` }
})

const ids = Array.from(
  { length: 10 },
  (_, i) => i,
)

const main2 = Fork.all(ids.map(getUser))
  .pipe(
    flatMap(Task.wait),
    flatMap(users => Console.log("Got users", users))
  )

main2.pipe(
  Time.defaultTime,
  Console.defaultConsole,
  Fork.bounded(3),
  runPromise
)


