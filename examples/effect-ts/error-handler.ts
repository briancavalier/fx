import { flatMap, ok, run } from "../../src"
import { catchOnly, fail } from "../../src/Fail"
import { defaultConsole, error, log } from "../../src/Console"
import { float, defaultRandom } from "../../src/Random"

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
