import { Console, Fail, Random, flatMap, ok, run } from "../../src"

class CustomError {
  constructor(readonly value: number) { }
}

const maybeFail = Random.float.pipe(
  flatMap(value => value > 0.5
    ? Fail.fail(new CustomError(value))
    : ok(value)
  )
)

const main = maybeFail.pipe(
  flatMap(value => Console.log(`Value is ${value}`)),
  Fail.catchOnly(CustomError, e =>
    Console.error(`Oops! Got value`, e)
  ),
)

main.pipe(
  Console.defaultConsole,
  Random.defaultRandom(),
  run
)
