import { flatMap, ok, run } from "../../src/index.js"
import { catchOnly, fail } from "../../src/Fail.js"
import { defaultConsole, error, log } from "../../src/Console.js"
import { float, defaultRandom } from "../../src/Random.js"

class CustomError {
  constructor(readonly value: number) { }
}

const maybeFail = float.pipe(
  flatMap(value => value > 0.5
    ? fail(new CustomError(value))
    : ok(value)
  )
)

const main = maybeFail.pipe(
  flatMap(value => log(`Value is ${value}`)),
  catchOnly(CustomError, e =>
    error(`Oops! Got value`, e)
  ),
)

main.pipe(
  defaultConsole,
  defaultRandom(),
  run
)
