import { run } from "../../src"
import { log, defaultConsole } from "../../src/Console"

const main = log('Hello, World!')

main.pipe(defaultConsole, run)
