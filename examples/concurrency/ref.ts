import { inspect } from 'node:util'
import { Fork, Fx, fx, Ref, runPromise, Task, Time } from '../../src'

const f = (r: Ref.Ref<number>) => fx(function* () {
  const x0 = yield* increment(r)
  const x1 = yield* increment(r)
  const x2 = yield* increment(r)
  return [x0, x1, x2]
})

const increment = (r: Ref.Ref<number>): Fx<Time.Sleep, number> => fx(function* () {
  const a = r.get()
  yield* Time.sleep(10)
  return Ref.compareAndSet(r, a, a + 1) ? a : yield* increment(r)
})

const main = (r: Ref.Ref<number>) => fx(function* () {
  const r1 = yield* Fork.all([f(r), f(r)])
  const r3 = yield* Task.wait(r1)
  return r3
})

const ref = Ref.of(1)

const r = main(ref)
  .pipe(
    Time.defaultTime,
    Fork.unbounded,
    runPromise
  ).then(x => console.log(inspect(x, false, Infinity)))
