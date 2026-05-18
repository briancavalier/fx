import { defaultConsole, log } from '../../src/Console.js'
import { fx, run } from '../../src/Fx.js'

const main = log('Hello, Fx!')

main.pipe(defaultConsole, run)
