import { Effect } from './Effect.js';
import { flatten, ok } from './Fx.js';
import { handle } from './Handler.js';
import { XoroShiro128Plus, generateSeed, uniformFloat, uniformIntMax } from './internal/random.js';
/**
 * The next 32-bit integer in [0, max)
 * Not cryptographically secure.
 */
export class Int extends Effect('fx/Random/Int') {
}
/**
 * Get the next 32-bit integer in [0, max)
 * Not cryptographically secure.
 */
export const int = (max = 0xFFFFFFFF) => new Int(max);
/**
 * The next float in range [0, 1)
 * Not cryptographically secure.
 */
export class Float extends Effect('fx/Random/Float') {
}
/**
 * Get the next float in range [0, 1)
 * Not cryptographically secure.
 */
export const float = new Float();
/**
 * Split the random number generator into two independent generators.
 */
export class Split extends Effect('fx/Random/Split') {
}
/**
 * Split the random number generator into two independent generators.
 */
export const split = (f) => new Split(f).returning().pipe(flatten);
/**
 * Random handler using the xoroshiro128+ algorithm.
 * Not cryptographically secure.
 */
export const xoroshiro128plus = (seed) => (f) => runXoroShiro128Plus(XoroShiro128Plus.fromSeed(seed), f);
/**
 * Default random number generator.
 * When not given a seed, one is generated based on the current time.
 * When given the same seed, distinct handlers generate the same sequences.
 *
 * Not cryptographically secure.
 */
export const defaultRandom = (seed = generateSeed()) => xoroshiro128plus(seed);
const runXoroShiro128Plus = (gen, f) => f.pipe(handle(Int, max => ok(uniformIntMax(max.arg, gen))), handle(Float, _ => ok(uniformFloat(gen))), handle(Split, f => {
    const gen2 = gen.clone();
    gen2.unsafeJump();
    return ok(runXoroShiro128Plus(gen2, f.arg));
}));
