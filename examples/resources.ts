import { nodeSourceLookup } from "../src/TraceNode"
import { assertSync, formatDiagnostic, fx, runPromise } from "../src"
import { all, defaultAll, unbounded } from "../src/Concurrent"
import { defaultConsole, error } from "../src/Console"
import { catchAll, fail } from "../src/Fail"
import { managed, usingManaged, withFinalization } from "../src/Finalization"
import { defaultTime, sleep } from "../src/Time"

const myResource = (name: string) => fx(function* () {
  yield* sleep(100)
  return managed(
    name,
    exit => assertSync(() => console.log(`releasing resource: ${name} after ${exit.type}`))
  )
})

const f = (n: number) => fx(function* () {
  const resource = yield* usingManaged(myResource(`my-resource-${n}`))

  console.log(`using resource: ${resource}`)

  yield* sleep(1000)
  yield* fail(new Error('Simulated failure'))

  console.log(`done using resource: ${resource}`)
})

await all([f(1), f(2)]).pipe(
  defaultAll,
  withFinalization,
  defaultTime,
  unbounded,
  catchAll(e => error('failed', formatDiagnostic(e, { source: { lookup: nodeSourceLookup() } }))),
  defaultConsole,
  runPromise
)
