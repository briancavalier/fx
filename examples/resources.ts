import { Fail, Fork, Resource, Time, assertSync, fx, runPromise } from "../src"

const scarceResource = (name: string) => assertSync(() => {
  console.log(`acquiring scarce resource: ${name}`)
  return [name, {
    [Symbol.dispose]: () => {
      console.log(`disposing scarce resource: ${name}`)
    }
  }]
})

const f = fx(function* () {
  const resource = yield* Resource.acquire(scarceResource('my-resource'))
  console.log(`using resource: ${resource}`)
  yield* Time.sleep(1000)
  yield* Fail.fail(new Error('Simulated failure'))
  console.log(`done using resource: ${resource}`)
})

Fork.all([f, f, f]).pipe(
  Time.defaultTime,
  Fail.assert,
  Fork.unbounded,
  x => x,
  runPromise
)
