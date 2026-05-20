import { consoleLog, defaultConsole } from '@briancavalier/fx'
import { run } from '@briancavalier/fx'

const main = consoleLog('Hello, Fx!')

main.pipe(defaultConsole, run)
