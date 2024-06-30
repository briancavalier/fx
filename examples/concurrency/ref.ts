import { flatMap, Fork, Fx, fx, map, Random, Ref, runPromise, Task, Time } from '../../src'

const randomSleep = Random.int(100).pipe(flatMap(Time.sleep))

// TODO: Consider moving to Ref module
const atomically = <E, A>(f: (a: A) => Fx<E, A>) => (r: Ref.Ref<A>): Fx<E, A> => fx(function* () {
  const a = r.get()
  const b = yield* f(a)
  return Ref.compareAndSet(r, a, b) ? a : yield* atomically(f)(r)
})

const f = (r: Ref.Ref<number>) => fx(function* () {
  const x0 = yield* increment(r)
  const x1 = yield* increment(r)
  const x2 = yield* increment(r)
  return [x0, x1, x2]
})

const increment = atomically((n: number) => randomSleep.pipe(map(_ => n + 1)))

const main = (r: Ref.Ref<number>) => fx(function* () {
  const r1 = yield* Fork.all([f(r), f(r)])
  const r3 = yield* Task.wait(r1)
  return r3
})

const ref = Ref.of(1)

const r = main(ref)
  .pipe(
    Time.defaultTime,
    Random.defaultRandom(),
    Fork.unbounded,
    runPromise
  ).then(console.log)
