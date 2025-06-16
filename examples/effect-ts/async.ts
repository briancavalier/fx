import { Console, Fork, Time, andThen, runPromise } from "../../src"

const main = Time.sleep(1000).pipe(
  andThen(Console.log('Hello, World!'))
)

main.pipe(
  Console.defaultConsole,
  Time.defaultTime,
  Fork.unbounded,
  runPromise
)
