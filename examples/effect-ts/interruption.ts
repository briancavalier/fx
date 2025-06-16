import { Console, Fail, Fork, Time, andThen, runPromise } from "../../src"

const main = Fork.race([
  Time.sleep(1000).pipe(andThen(Console.log("Hello"))),
  Time.sleep(500).pipe(andThen(Fail.fail("Aborted!")))
])

main.pipe(
  Console.defaultConsole,
  Time.defaultTime,
  Fork.unbounded,
  runPromise
)

