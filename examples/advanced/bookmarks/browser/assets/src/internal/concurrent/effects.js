import { Effect } from '../../Effect.js';
/**
 * Request that a computation be started concurrently.
 *
 * A `Fork` request returns a {@link Task} handle. The scheduling strategy is
 * supplied by handlers such as `withBoundedConcurrency` or `withUnboundedConcurrency`.
 */
export class Fork extends Effect('fx/Concurrent/Fork') {
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
