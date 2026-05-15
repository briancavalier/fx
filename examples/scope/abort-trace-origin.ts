import { Abort, abort } from '../../src/Abort.js'
import { defaultConsole, error } from '../../src/Console.js'
import { Fail, failFrom, returnFail } from '../../src/Fail.js'
import { fx, run, type Fx } from '../../src/Fx.js'
import { control } from '../../src/Handler.js'
import { scope } from '../../src/Scope.js'
import { formatDiagnostic, setTraceCapturePolicy } from '../../src/Trace.js'
import { nodeSourceLookup } from '../../src/TraceNode.js'

setTraceCapturePolicy('full')

const RequestScope = 'examples/scope/abort-trace-origin' as const
const sourceLookup = nodeSourceLookup()

const program = fx(function* () {
  return yield* validate()
}).pipe(scope(RequestScope))

reportAbort(program).pipe(
  defaultConsole,
  run
)

function validate() {
  return fx(function* () {
    yield* abort(RequestScope)
    return 'valid'
  })
}

function reportAbort<A>(program: Fx<Abort<typeof RequestScope>, A>) {
  return fx(function* () {
    const result = yield* program.pipe(
      control(Abort, (_, abort) =>
        failFrom(abort, new Error('unhandled request abort'))
      ),
      returnFail
    )

    if (!Fail.is(result)) return

    yield* error(formatDiagnostic(result, { source: { lookup: sourceLookup } }))
  })
}
