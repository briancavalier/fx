import { Fail, Fork, Scope, Task, Time, assertSync, flatMap, fx, runPromise } from "../src"

const myResource = (name: string) => fx(function* () {
  yield* Time.sleep(100)
  return [
    name,
    assertSync(() => console.log(`releasing resource: ${name}`))
  ]
})

const f = fx(function* () {
  const [resource, release] = yield* myResource('my-resource')
  yield* Scope.finalize(release)

  console.log(`using resource: ${resource}`)

  yield* Time.sleep(1000)
  yield* Fail.fail(new Error('Simulated failure'))

  console.log(`done using resource: ${resource}`)
})

Fork.all([f, f]).pipe(
  flatMap(Task.wait),
  Scope.scope,
  Time.defaultTime,
  Fork.unbounded,
  Fail.assert,
  runPromise
)
