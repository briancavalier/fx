import { Log, run } from "../../src"

const main = Log.info('Hello, World!')

main.pipe(Log.console, run)
