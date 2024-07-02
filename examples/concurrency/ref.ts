import { flatMap, Fork, Fx, fx, Random, Ref, runPromise, Task, Time } from '../../src'

const randomSleep = Random.int(100).pipe(flatMap(Time.sleep))

const f = (r: Ref.Ref<number>) => fx(function* () {
  const x0 = yield* increment(r)
  const x1 = yield* increment(r)
  const x2 = yield* increment(r)
  return [x0, x1, x2]
})

const increment = (r: Ref.Ref<number>): Fx<Time.Sleep | Random.Int, number> => fx(function* () {
  const x = r.get()
  yield* randomSleep
  return Ref.compareAndSet(r, x, x + 1) ? x : yield* increment(r)
})

const main = (r: Ref.Ref<number>) => fx(function* () {
  const r1 = yield* Fork.all([f(r), f(r)])
  const r3 = yield* Task.wait(r1)
  return r3
})

main(Ref.of(1))
  .pipe(
    Time.defaultTime,
    Random.defaultRandom(),
    Fork.unbounded,
    runPromise
  ).then(console.log)
