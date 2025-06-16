import { Fail, Log, Random, flatMap, ok, run } from "../../src"

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
  flatMap(value => Log.info(`Value is ${value}`)),
  Fail.catchOnly(CustomError, e =>
    Log.error(`Oops! Got value`, e)
  ),
)

main.pipe(
  Log.console,
  Random.defaultRandom(),
  run
)
