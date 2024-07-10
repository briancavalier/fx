import { flatMap, Fork, Fx, fx, Random, Ref, runPromise, Task, Time } from '../../src'

// Simple Ref example
// A Ref is a mutable reference to a value that can be read and updated atomically
// using a compare-and-set operation. Multiple concurrent tasks can read and write
// a shared Ref safely without locks.

const randomSleep = Random.int(100).pipe(flatMap(Time.sleep))

const f = (r: Ref.Of<number>) => fx(function* () {
  const x0 = yield* increment(r)
  const x1 = yield* increment(r)
  const x2 = yield* increment(r)
  return [x0, x1, x2]
})

const increment = (r: Ref.Of<number>): Fx<Time.Sleep | Random.Int, number> => fx(function* () {
  const x = r.get()
  // Simulate an async operation, e.g. network fetch
  yield* randomSleep
  return Ref.compareAndSet(r, x, x + 1) ? x : yield* increment(r)
})

const r = Ref.of(1)

// Run three concurrent tasks that interleave and increment the same Ref
// compareAndSet guarantees safe updates, and this will never print
// any duplicate values
Fork.all([f(r), f(r), f(r)])
  .pipe(
    flatMap(Task.wait),
    Time.defaultTime,
    Random.defaultRandom(),
    Fork.unbounded,
    runPromise
  ).then(console.log)
