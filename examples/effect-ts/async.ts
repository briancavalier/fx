import { Fork, Log, Time, andThen, runPromise } from "../../src"

const main = Time.sleep(1000).pipe(andThen(Log.info('Hello, World!')))

main.pipe(
  Log.console,
  Time.defaultTime,
  Fork.unbounded,
  runPromise
)
