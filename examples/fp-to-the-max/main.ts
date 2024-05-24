import { Effect, Env, Fail, fx, ok } from '../../src'

// -------------------------------------------------------------------
// The number guessing game example from
// https://www.youtube.com/watch?v=sxudIMiOo68

// -------------------------------------------------------------------
// #region New effects the game will need

export class Print extends Effect('Print')<string, void> { }

const print = (s: string) => new Print(s)

export class Read extends Effect('Read')<string, string> { }

const read = (prompt: string) => new Read(prompt)

export const toInteger = (s: string) => {
  const i = Number.parseInt(s, 10)
  return Number.isInteger(i) ? ok(i) : Fail.fail(`"${s}" is not an integer`)
}

export class GenerateSecret extends Effect('GetSecret')<number, number> { }

const generateSecret = (max: number) => new GenerateSecret(max)

// #endregion

// -------------------------------------------------------------------
// The game

// Core "business logic": evaluate the user's guess
export const checkAnswer = (secret: number, guess: number): boolean =>
  secret === guess

// Main game loop. Play round after round until the user chooses to quit
export const main = fx(function* () {
  const name = yield* read(`What's your name? `)
  yield* print(`Hello, ${name}. Welcome to the game!`)

  const { max } = yield* Env.get<{ max: number }>()

  do
    yield* play(name, max)
  while (yield* checkContinue(name))

  yield* print(`Thanks for playing, ${name}.`)
})

// Play one round of the game.  Generate a number and ask the user
// to guess it.
const play = (name: string, max: number) => fx(function* () {
  // It doesn't actually matter whether we generate the number before
  // or after the user guesses, but we'll do it here
  const secret = yield* generateSecret(max)

  const result = yield* read(`Dear ${name}, please guess a number from 1 to ${max}: `)

  const guess = yield* toInteger(result).pipe(Fail.orElse(undefined))
  if (typeof guess !== 'number')
    yield* print('You did not enter an integer!')
  else if (checkAnswer(secret, guess))
    yield* print(`You guessed right, ${name}!`)
  else
    yield* print(`You guessed wrong, ${name}! The number was: ${secret}`)
})

// Ask the user if they want to play again.
// Note that we keep asking until the user gives an answer we recognize
const checkContinue = (name: string) => fx(function* () {
  while (true) {
    const answer = yield* read(`Do you want to continue, ${name}? (y/n) `)
    switch (answer.trim().toLowerCase()) {
      case 'y': return true
      case 'n': return false
      default: yield* print('Please enter y or n.')
    }
  }
})
