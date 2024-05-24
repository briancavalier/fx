import { Effect } from './Effect'
import { Fx, fx, handle, ok } from './Fx'
import { XoroShiro128Plus, uniformFloat, uniformIntMax } from './internal/random'

/**
 * The next 32-bit integer in [0, max)
 */
export class Int extends Effect('fx/Random/Int')<number, number> { }

/**
 * Get the next 32-bit integer in [0, max)
 */
export const int = (max = 0xFFFFFFFF) => new Int(max)

/**
 * The next float in range [0, 1)
 */
export class Float extends Effect('fx/Random/Float')<void, number> { }

/**
 * Get the next float in range [0, 1)
 */
export const float = new Float()

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

type Random = Int | Float | Split

/**
 * Random handler using the xoroshiro128+ algorithm.
 */
export const xoroshiro128plus = (seed: number) => <const E, const A>(f: Fx<E, A>): Fx<Exclude<E, Random>, A> =>
  runXoroShiro128Plus(XoroShiro128Plus.fromSeed(seed), f)

const runXoroShiro128Plus = <const E, const A>(gen: XoroShiro128Plus, f: Fx<E, A>): Fx<Exclude<E, Random>, A> => f.pipe(
  handle(Int, max => ok(uniformIntMax(max + 1, gen))),
  handle(Float, _ => ok(uniformFloat(gen))),
  handle(Split, f => {
    const gen2 = gen.clone()
    gen2.unsafeJump()
    return ok(runXoroShiro128Plus(gen2, f))
  })
) as Fx<Exclude<E, Random>, A>
