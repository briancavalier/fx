import { flatMap, Fx, fx, runPromise } from '../../src'
import { all, defaultAll, unbounded } from '../../src/Concurrent'
import { Int, int, defaultRandom } from '../../src/Random'
import { Sleep, sleep, defaultTime } from '../../src/Time'
import { compareAndSet, of, type Of } from '../../src/Ref'

// Simple Ref example
// A Ref is a mutable reference to a value that can be read and updated atomically
// using a compare-and-set operation. Multiple concurrent tasks can read and write
// a shared Ref safely without locks.

const randomSleep = int(100).pipe(flatMap(sleep))

const f = (r: Of<number>) => fx(function* () {
  const x0 = yield* increment(r)
  const x1 = yield* increment(r)
  const x2 = yield* increment(r)
  return [x0, x1, x2]
})

const increment = (r: Of<number>): Fx<Sleep | Int, number> => fx(function* () {
  const x = r.get()
  // Simulate an async operation, e.g. network fetch
  yield* randomSleep
  return compareAndSet(r, x, x + 1) ? x : yield* increment(r)
})

const r = of(1)

// Run three concurrent tasks that interleave and increment the same Ref
// compareAndSet guarantees safe updates, and this will never print
// any duplicate values
await all([f(r), f(r), f(r)])
  .pipe(
    defaultAll,
    defaultTime,
    defaultRandom(),
    unbounded,
    runPromise
  ).then(console.log)
