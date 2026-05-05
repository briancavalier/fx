import { andThen, runPromise } from "../../src"
import { defaultConsole, error, log } from "../../src/Console"
import { catchAll } from "../../src/Fail"
import { unbounded } from "../../src/Fork"
import { defaultTime, sleep } from "../../src/Time"
import { defaultTimeout, timeout } from "../../src/Timeout"

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
