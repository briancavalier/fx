import { Effect } from '../../Effect.js';
/**
 * Request that a computation be started concurrently.
 *
 * A `Fork` request returns a {@link Task} handle. The scheduling policy is
 * supplied by handlers such as `withBoundedConcurrency` or `withUnboundedConcurrency`.
 */
export class Fork extends Effect('fx/Concurrent/Fork') {
}
export const allPolicy = { tag: 'all' };
export const firstSettledPolicy = { tag: 'firstSettled' };
export const firstSuccessPolicy = { tag: 'firstSuccess' };
/**
 * Request that a group of computations run concurrently with a structured
 * settlement policy.
 */
export class Concurrently extends Effect('fx/Concurrent/Concurrently') {
}
/**
 * Failure returned by `firstSuccess` when every raced child fails.
 */
export class RaceAllFailed extends Error {
    name = 'RaceAllFailed';
    errors;
    constructor(errors) {
        super('All raced computations failed');
        Object.defineProperty(this, 'code', {
            value: 'FX_RACE_ALL_FAILED',
            enumerable: false,
            writable: false,
            configurable: true
        });
        Object.defineProperty(this, 'errors', {
            value: errors,
            enumerable: false,
            writable: false,
            configurable: true
        });
    }
}
