import { assertSync, flatMap, fx, runPromise } from "../src"
import { assert, fail } from "../src/Fail"
import { all, unbounded } from "../src/Fork"
import { finalize, scope } from "../src/Scope"
import { wait } from "../src/Task"
import { sleep, defaultTime } from "../src/Time"

const myResource = (name: string) => fx(function* () {
  yield* sleep(100)
  return [
    name,
    assertSync(() => console.log(`releasing resource: ${name}`))
  ]
})

const f = fx(function* () {
  const [resource, release] = yield* myResource('my-resource')
  yield* finalize(release)

  console.log(`using resource: ${resource}`)

  yield* sleep(1000)
  yield* fail(new Error('Simulated failure'))

  console.log(`done using resource: ${resource}`)
})

await all([f, f]).pipe(
  flatMap(wait),
  scope,
  defaultTime,
  unbounded,
  assert,
  runPromise
)
