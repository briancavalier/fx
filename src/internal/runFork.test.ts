import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { at } from '../Breadcrumb.js'
import { fx, ok } from '../Fx.js'
import { acquireAndRunFork } from './runFork.js'
import type { Semaphore } from './Semaphore.js'

describe('runFork', () => {
  it('releases an acquired semaphore slot when interrupted before the fork starts', async () => {
    const acquired = Promise.withResolvers<void>()
    const events: string[] = []
    let releases = 0
    const semaphore = {
      total: 1,
      acquire: () => ({
        promise: acquired.promise,
        [Symbol.dispose]() { }
      }),
      release: () => {
        releases += 1
      }
    } as unknown as Semaphore

    const task = acquireAndRunFork({
      fx: fx(function* () {
        events.push('started')
        return yield* ok('done')
      }),
      origin: at('test/runFork/acquired-interrupted'),
      trace: undefined
    }, semaphore)

    acquired.resolve()
    await Promise.resolve()
    await withTimeout(task.interrupt('stop'), 100)

    assert.deepEqual(events, [])
    assert.equal(releases, 1)
  })
})

const withTimeout = async <A>(promise: Promise<A>, ms: number): Promise<A> =>
  await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    })
  ])
