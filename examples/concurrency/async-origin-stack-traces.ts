import { fx, runPromise } from "../../src/index.js"
import { assertPromise } from "../../src/Async.js"
import { fork, unbounded } from "../../src/Concurrent.js"
import { defaultConsole, error, log } from "../../src/Console.js"
import { catchAll } from "../../src/Fail.js"
import { wait } from "../../src/Task.js"
import { formatDiagnostic, formatError, snapshotError } from "../../src/Trace.js"
import { nodeSourceLookup } from "../../src/TraceNode.js"

const sourceLookup = nodeSourceLookup()

const loadUser = assertPromise(async () => {
  await Promise.resolve()
  throw new Error('loadUser request failed')
})

const program = fx(function* () {
  yield* log('forking loadUser')
  const task = yield* fork(loadUser)
  return yield* wait(task)
})

await program.pipe(
  catchAll(errorWithTrace),
  unbounded,
  defaultConsole,
  runPromise
)

function errorWithTrace(e: unknown) {
  return error([
    'Human-readable diagnostic:',
    formatDiagnostic(e, { source: { lookup: sourceLookup } }),
    '',
    'Short human-readable error:',
    formatError(e),
    '',
    'Structured diagnostic snapshot:',
    JSON.stringify(snapshotError(e), null, 2)
  ].join('\n'))
}
