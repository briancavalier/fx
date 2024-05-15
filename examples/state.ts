import { setTimeout } from 'timers/promises'
import { inspect } from 'util'

import { Async, Effect, Fork, Fx, Task, fx, handle, map, ok, run } from '../src'

// The usual state monad, as an effect
class Get<A> extends Effect('State/Set')<void, A> { }
class Set<A> extends Effect('State/Get')<A, void> { }

const get = <const A>() => new Get<A>()
const set = <const A>(a: A) => new Set(a)

const runState = <const E, const A>(s: State<E>, f: Fx<E, A>) => withState(s, f).pipe(map(([a]) => a))
// const getState = <const E, const A>(s: State<E>, f: Fx<E, A>) => withState(s, f).pipe(map(([, s]) => s))

const withState = <const E, const A, const S = State<E>>(s: S, f: Fx<E, A>) => {
  let state = s
  return f.pipe(
    handle(Get, _ => ok(state)),
    handle(Set, newState => {
      state = newState as S
      return ok(undefined)
    }),
    map(a => [a, state])
  ) as Fx<Exclude<E, Get<State<E>> | Set<State<E>>>, readonly [A, S]>
}

type State<E> = U2I<StateOf<E>>
type StateOf<E> = E extends Get<infer S> | Set<infer S> ? S : never
type U2I<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never

const delay = (ms: number) => Async.run(
  signal => setTimeout(ms, undefined, { signal })
)

const f = fx(function* () {
  const x0 = yield* get<number>()
  yield* set(x0 + 1)
  yield* delay(1)
  const x1 = yield* get<number>()
  yield* set(x1 + 1)
  yield* delay(1)
  const x2 = yield* get<number>()
  return [x0, x1, x2]
})

const main1 = fx(function* () {
  const r1 = yield* Fork.all([f, f])
  const r3 = yield* Task.wait(r1)
  return r3
})

const main2 = fx(function* () {
  const r1 = yield* Fork.all([runState(1, f), runState(1, f)], 'concurrent state')
  const r3 = yield* Task.wait(r1)
  return r3
})

const main = fx(function* () {
  return {
    // Sharing state
    shared: yield* runState(1, main1),
    // Isolated state
    isolated: yield* main2
  }
})

const r = main.pipe(run).promise.then(x => console.log(inspect(x, false, Infinity)))
