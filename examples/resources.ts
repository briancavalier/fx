import { Fail, Fork, Resource, Task, Time, assertSync, flatMap, fx, runPromise } from "../src"

const myResource = (name: string) => fx(function* () {
  yield* Time.sleep(100)
  return [
    name,
    assertSync(() => console.log(`releasing resource: ${name}`))
  ]
})

const f = fx(function* () {
  const resource = yield* Resource.acquire(myResource('my-resource'))
  console.log(`using resource: ${resource}`)
  yield* Time.sleep(1000)
  yield* Fail.fail(new Error('Simulated failure'))
  console.log(`done using resource: ${resource}`)
})

Fork.all([f, f]).pipe(
  flatMap(Task.wait),
  Resource.scope,
  Time.defaultTime,
  Fork.unbounded,
  Fail.assert,
  runPromise
)
