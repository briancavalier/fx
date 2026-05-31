import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Semaphore } from './Semaphore.js'

describe('Semaphore', () => {
  it('does not drop a permit when a queued waiter is cancelled before its release microtask runs', async () => {
    const semaphore = new Semaphore(1)
    const first = semaphore.acquire()
    await first.promise

    const second = semaphore.acquire()
    const third = semaphore.acquire()
    let secondAcquired = false
    let thirdAcquired = false

    second.promise.then(() => {
      secondAcquired = true
    })
    third.promise.then(() => {
      thirdAcquired = true
    })

    semaphore.release()
    second[Symbol.dispose]()

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(secondAcquired, false)
    assert.equal(thirdAcquired, true)
  })
})
