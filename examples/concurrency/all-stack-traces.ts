import { fx, runPromise } from "../../src/index.js"
import { all, defaultAll, unbounded } from "../../src/Concurrent.js"
import { defaultConsole, error, log } from "../../src/Console.js"
import { catchAll, fail } from "../../src/Fail.js"
import { formatDiagnostic, formatError, snapshotError } from "../../src/Trace.js"
import { nodeSourceLookup } from "../../src/TraceNode.js"

const sourceLookup = nodeSourceLookup()

const child1 = fx(function* () {
  yield* log('child1 start')
  return 'child1 ok'
})

const child2 = fx(function* () {
  yield* log('child2 start, about to fail')
  yield* fail(new Error('child2 failed'))
  return 'unreachable'
})

const child3 = fx(function* () {
  yield* log('child3 start')
  return 'child3 ok'
})

await all([child1, child2, child3]).pipe(
  defaultAll,
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
