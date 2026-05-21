import { flatMap, Fx, fx, runPromise } from '@briancavalier/fx'
import { all, defaultAll, unbounded } from '@briancavalier/fx/concurrent'
import { Int, int, defaultRandom } from '@briancavalier/fx/random'
import { Sleep, sleep, defaultTime } from '@briancavalier/fx/time'
import { Ref } from '@briancavalier/fx/ref'

// Simple Ref example
// Ref is a low-level mutable reference primitive. Multiple concurrent tasks can
// coordinate shared updates with compare-and-set.

const randomSleep = int(100).pipe(flatMap(sleep))

const f = (r: Ref<number>) => fx(function* () {
  const x0 = yield* increment(r)
  const x1 = yield* increment(r)
  const x2 = yield* increment(r)
  return [x0, x1, x2]
})

const increment = (r: Ref<number>): Fx<Sleep | Int, number> => fx(function* () {
  const x = r.get()
  // Simulate an async operation, e.g. network fetch
  yield* randomSleep
  return r.compareAndSet(x, x + 1) ? x : yield* increment(r)
})

const r = new Ref(1)

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
