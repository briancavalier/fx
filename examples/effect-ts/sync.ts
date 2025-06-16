import { Console, run } from "../../src"

const main = Console.log('Hello, World!')

main.pipe(Console.defaultConsole, run)
