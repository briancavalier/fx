import { Fx, flatMap, flatten, ok } from '../../Fx.js'
import { Handle } from '../../Handler.js'
import { HandlerCapture, handleCaptured, withCapturedHandlers } from '../../HandlerCapture.js'
import { Task } from '../../Task.js'
import { Semaphore } from '../Semaphore.js'
import { acquireAndRunFork } from '../runFork.js'
import { Fork } from './effects.js'

/**
 * Handle Fork by running at most `maxConcurrency` forked computations at once.
 */
export const withBoundedConcurrency = (maxConcurrency: number) => <const E, const A>(f: Fx<E, A>): Fx<WithConcurrencyHandledEffects<E>, A> => {
  const semaphore = new Semaphore(maxConcurrency)
  return (
  withCapturedHandlers('fx/Concurrent/Fork', f).pipe(
    flatMap(fx =>
      ok(fx.pipe(
        handleCaptured('fx/Concurrent/Fork', Fork, runForkWith(semaphore))
      ))
    ),
    flatten
  ) as Fx<WithConcurrencyHandledEffects<E>, A>
  )
}

/**
 * Handle Fork by running forked computations without a concurrency limit.
 */
export const withUnboundedConcurrency = withBoundedConcurrency(Infinity)

const runForkWith = (s: Semaphore) =>
  (fork: Fork): Fx<never, Task<unknown, unknown>> =>
    ok(acquireAndRunFork(fork.arg, s))

type WithConcurrencyHandledEffects<E> =
  Handle<Handle<E, Fork>, HandlerCapture<'fx/Concurrent/Fork'>>
