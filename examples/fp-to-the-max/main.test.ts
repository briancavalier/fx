import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Fx, handle, map, ok, run } from '../../src/index.js'
import { provide } from '../../src/Env.js'

import { GenerateSecret, Print, Read, checkAnswer, main } from './main.js'

// -------------------------------------------------------------------
// #region Handlers
// *Pure* handlers for all the effects the game needs.
// This version of the game is completely pure, with no side effects.

const handlePrint = <E, A>(f: Fx<E, A>) => {
  const printed = [] as string[]
  return f.pipe(
    handle(Print, print => ok(void printed.push(print.arg))),
    map(_ => printed)
  )
}

const handleRead = ([...inputs]: readonly string[]) =>
  handle(Read, _ => ok(inputs.shift()!))

const handleGenerateSecret = ([...values]: readonly number[]) =>
  handle(GenerateSecret, max => ok(Math.min(max.arg, values.shift()!)))

// #endregion
// -------------------------------------------------------------------
// #region Tests

// The "usual" tests we'd write for a pure function
describe('checkAnswer', () => {
  it('should return true if the guess is correct', () => {
    const x = Math.random()
    assert.ok(checkAnswer(x, x))
  })

  it('should return false if the guess is incorrect', () => {
    const x = Math.random()
    assert.ok(!checkAnswer(x, x + 1))
  })
})

// We can also test main
// Tests are pure, no async, no promises, no side effects.
describe('main', () => {
  it('should play the game', () => {
    // Random.Int generates [0, max), so we need to add 1 to the max
    const secretNumbers = [1, 2, 3, 4]
    const range = {
      max: Math.max(...secretNumbers)
    }

    const result = main.pipe(
      handleGenerateSecret(secretNumbers),
      handleRead(['Brian', '1', 'y', '2', 'y', '3', 'y', '1', 'n']),
      handlePrint,
      provide(range),
      run
    )

    assert.deepEqual(result, [
      'Hello, Brian. Welcome to the game!',
      'You guessed right, Brian!',
      'You guessed right, Brian!',
      'You guessed right, Brian!',
      'You guessed wrong, Brian! The number was: 4',
      'Thanks for playing, Brian.'
    ])
  })
})

// #endregion
