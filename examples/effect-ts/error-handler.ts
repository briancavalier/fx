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
  flatMap(value => Log.info(`Got value ${value}`)),
  Fail.catchOnly(CustomError, e =>
    Log.error(`Oops! Got value ${e.value}`)
  ),
)

console.log(main.pipe(
  Log.console,
  Random.defaultRandom(),
  run
))
