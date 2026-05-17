import { defaultRuntime, flatMap, fx, runPromise } from "../../src/index.js"
import { log } from "../../src/Console.js"
import { all, bounded, defaultAll } from "../../src/Concurrent.js"
import { sleep } from "../../src/Time.js"

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
