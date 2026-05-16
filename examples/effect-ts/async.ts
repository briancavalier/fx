import { andThen, defaultRuntime, runPromise } from "../../src/index.js"
import { log } from "../../src/Console.js"
import { unbounded } from "../../src/Concurrent.js"
import { sleep } from "../../src/Time.js"

const main = sleep(1000).pipe(
  andThen(log('Hello, World!'))
)

await main.pipe(
  ...defaultRuntime,
  unbounded,
  runPromise
)
