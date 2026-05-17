import { run } from "../../src/index.js"
import { log, defaultConsole } from "../../src/Console.js"

const main = log('Hello, World!')

main.pipe(defaultConsole, run)
