import { defaultRuntime, flatMap, fx, runPromise } from "../../src"
import { log } from "../../src/Console"
import { all, bounded, defaultAll } from "../../src/Concurrent"
import { sleep } from "../../src/Time"

const getUser = (id: number) => fx(function* () {
  yield* sleep(1000) // Simulate a delay
  return { id, name: `User ${id}` }
})

const ids = Array.from(
  { length: 10 },
  (_, i) => i,
)

const main2 = all(ids.map(getUser))
  .pipe(
    defaultAll,
    flatMap(users => log("Got users", users))
  )

await main2.pipe(
  ...defaultRuntime,
  bounded(3),
  runPromise
)
