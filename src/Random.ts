import { Effect } from './Effect'
import { Fx, fx, handle, ok } from './Fx'
import { XoroShiro128Plus, fromSeed } from './internal/random'

/**
 * Get the next 32-bit integer.
 */
export class Int32 extends Effect('fx/Random/Int32')<void, number> { }

/**
 * Get the next 32-bit integer.
 */
export const int32 = new Int32()

/**
 * Get the next N 32-bit integers. This is more efficient than calling `int32` N times
 */
export class Int32s extends Effect('fx/Random/Int32s')<number, readonly number[]> { }

/**
 * Get the next N 32-bit integers. This is more efficient than calling `int32` N times
 */
export const int32s = (n: number) => new Int32s(n)

/**
 * Split the random number generator into two independent generators.
 */
export class Split extends Effect('fx/Random/Split')<Fx<unknown, unknown>, Fx<unknown, unknown>> { }

/**
 * Split the random number generator into two independent generators.
 */
export const split = <const E, const A>(f: Fx<E, A>): Fx<E | Split, A> => fx(function* () {
  const f2 = yield* new Split(f).returning<Fx<E | Split, A>>()
  return yield* f2
})

type Random = Int32 | Int32s | Split

/**
 * Random handler using the xoroshiro128+ algorithm.
 */
export const xoroshiro128plus = (seed: number) => <const E, const A>(f: Fx<E, A>): Fx<Exclude<E, Random>, A> =>
  runXoroShiro128Plus(fromSeed(seed), f)

const runXoroShiro128Plus = <const E, const A>(gen: XoroShiro128Plus, f: Fx<E, A>): Fx<Exclude<E, Random>, A> => f.pipe(
  handle(Int32, _ => ok(gen.unsafeNext())),
  handle(Int32s, n => {
    const ns: number[] = []
    for (let i = 0; i < n; ++i) ns.push(gen.unsafeNext())
    return ok(ns)
  }),
  handle(Split, f => {
    const gen2 = gen.clone()
    gen2.unsafeJump()
    return ok(runXoroShiro128Plus(gen2, f))
  })
) as Fx<Exclude<E, Random>, A>
