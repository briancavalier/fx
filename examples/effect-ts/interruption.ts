import { Fail, Fork, Log, Time, andThen, runPromise } from "../../src"

const main = Fork.race([
  Time.sleep(1000).pipe(andThen(Log.info("Hello"))),
  Time.sleep(500).pipe(andThen(Fail.fail("Aborted!")))
])

main.pipe(
  Log.console,
  Time.defaultTime,
  Fork.unbounded,
  runPromise
)

