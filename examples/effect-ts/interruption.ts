import { andThen, runPromise } from "../../src/index.js"
import { defaultConsole, error, log } from "../../src/Console.js"
import { catchAll } from "../../src/Fail.js"
import { unbounded } from "../../src/Concurrent.js"
import { defaultTime, sleep } from "../../src/Time.js"
import { defaultTimeout, timeout } from "../../src/Timeout.js"

const main = sleep(1000).pipe(
  andThen(log("Hello")),
  timeout({ ms: 500, onTimeout: () => 'Aborted' })
)

await main.pipe(
  defaultTimeout(),
  catchAll(e => error(e)),
  defaultConsole,
  defaultTime,
  unbounded,
  runPromise
)
