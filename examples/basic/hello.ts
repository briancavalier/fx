import { consoleLog, defaultConsole, run } from '@briancavalier/fx'

const main = consoleLog('Hello, Fx!')

main.pipe(defaultConsole, run)
