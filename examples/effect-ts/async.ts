import { Console, Fork, Time, andThen, defaultRuntime, runPromise } from "../../src"

const main = Time.sleep(1000).pipe(
  andThen(Console.log('Hello, World!'))
)

main.pipe(
  ...defaultRuntime,
  Fork.unbounded,
  runPromise
)
