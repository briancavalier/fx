import { Effect } from './Effect'
import { Fx, flatten, ok } from './Fx'
import { handle } from './Handler'
import { XoroShiro128Plus, generateSeed, uniformFloat, uniformIntMax } from './internal/random'

// Random Effect
// Non-cryptographically secure random number generator

type Random = Int | Float | Split

/**
 * The next 32-bit integer in [0, max)
 * Not cryptographically secure.
 */
export class Int extends Effect('fx/Random/Int')<number, number> { }

/**
 * Get the next 32-bit integer in [0, max)
 * Not cryptographically secure.
 */
export const int = (max = 0xFFFFFFFF) => new Int(max)

/**
 * The next float in range [0, 1)
 * Not cryptographically secure.
 */
export class Float extends Effect('fx/Random/Float')<void, number> { }

/**
 * Get the next float in range [0, 1)
 * Not cryptographically secure.
 */
export const float = new Float()

/**
 * Split the random number generator into two independent generators.
 */
export class Split extends Effect('fx/Random/Split')<Fx<unknown, unknown>, Fx<unknown, unknown>> { }

/**
 * Split the random number generator into two independent generators.
 */
export const split = <const E, const A>(f: Fx<E, A>): Fx<E | Split, A> =>
  new Split(f).returning<Fx<E | Split, A>>().pipe(flatten)

/**
 * Random handler using the xoroshiro128+ algorithm.
 * Not cryptographically secure.
 */
export const xoroshiro128plus = (seed: number) => <const E, const A>(f: Fx<E, A>): Fx<Exclude<E, Random>, A> =>
  runXoroShiro128Plus(XoroShiro128Plus.fromSeed(seed), f)

/**
 * Default random number generator.
 * When not given a seed, one is generated based on the current time.
 * When given the same seed, distinct handlers generate the same sequences.
 *
 * Not cryptographically secure.
 */
export const defaultRandom = (seed = generateSeed()) => xoroshiro128plus(seed)

const runXoroShiro128Plus = <const E, const A>(gen: XoroShiro128Plus, f: Fx<E, A>): Fx<Exclude<E, Random>, A> => f.pipe(
  handle(Int, max => ok(uniformIntMax(max, gen))),
  handle(Float, _ => ok(uniformFloat(gen))),
  handle(Split, f => {
    const gen2 = gen.clone()
    gen2.unsafeJump()
    return ok(runXoroShiro128Plus(gen2, f))
  })
) as Fx<Exclude<E, Random>, A>
