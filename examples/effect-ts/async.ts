import { andThen, defaultRuntime, runPromise } from "../../src"
import { log } from "../../src/Console"
import { unbounded } from "../../src/Fork"
import { sleep } from "../../src/Time"

const main = sleep(1000).pipe(
  andThen(log('Hello, World!'))
)

await main.pipe(
  ...defaultRuntime,
  unbounded,
  runPromise
)
