import { fx, runPromise } from "../../src/index.js"
import { firstSettled, race, unbounded } from "../../src/Concurrent.js"
import { defaultConsole, error, log } from "../../src/Console.js"
import { catchAll, fail } from "../../src/Fail.js"
import { defaultTime, sleep } from "../../src/Time.js"
import { formatDiagnostic, formatError, snapshotError } from "../../src/Trace.js"
import { nodeSourceLookup } from "../../src/TraceNode.js"

const sourceLookup = nodeSourceLookup()

const child1 = fx(function* () {
  yield* log('child1 start')
  yield* sleep(10)
  return 'child1 ok'
})

const child2 = fx(function* () {
  yield* log('child2 start, about to fail')
  yield* fail(new Error('child2 failed'))
  return 'unreachable'
})

const child3 = fx(function* () {
  yield* log('child3 start')
  yield* sleep(10)
  return 'child3 ok'
})

await race([child1, child2, child3]).pipe(
  firstSettled,
  catchAll(errorWithTrace),
  unbounded,
  defaultTime,
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
