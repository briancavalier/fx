import { nodeSourceLookup } from "../src/TraceNode"
import { assertSync, formatDiagnostic, fx, runPromise } from "../src"
import { all, defaultAll, unbounded } from "../src/Concurrent"
import { defaultConsole, error } from "../src/Console"
import { catchAll, fail } from "../src/Fail"
import { managed, usingManaged } from "../src/Finalization"
import { scope } from "../src/Scope"
import { defaultTime, sleep } from "../src/Time"

const Resources = 'examples/resources' as const

const myResource = (name: string) => fx(function* () {
  yield* sleep(100)
  return managed(
    name,
    exit => assertSync(() => console.log(`releasing resource: ${name} after ${exit.type}`))
  )
})

const f = (n: number) => fx(function* () {
  const resource = yield* usingManaged(Resources, myResource(`my-resource-${n}`))

  console.log(`using resource: ${resource}`)

  yield* sleep(1000)
  yield* fail(new Error('Simulated failure'))

  console.log(`done using resource: ${resource}`)
})

await all([f(1), f(2)]).pipe(
  defaultAll,
  scope(Resources),
  defaultTime,
  unbounded,
  catchAll(e => error('failed', formatDiagnostic(e, { source: { lookup: nodeSourceLookup() } }))),
  defaultConsole,
  runPromise
)
