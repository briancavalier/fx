import { andThen, runPromise } from "../../src"
import { log, defaultConsole } from "../../src/Console"
import { fail } from "../../src/Fail"
import { race, unbounded } from "../../src/Fork"
import { sleep, defaultTime } from "../../src/Time"

const main = race([
  sleep(1000).pipe(andThen(log("Hello"))),
  sleep(500).pipe(andThen(fail("Aborted!")))
])

main.pipe(
  defaultConsole,
  defaultTime,
  unbounded,
  runPromise
)
