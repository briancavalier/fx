import { Effect, fx, ok } from '@briancavalier/fx'
import { abort, orReturn, scope, withScope, type Control } from '@briancavalier/fx/scope'

// -------------------------------------------------------------------
// The number guessing game example from
// https://www.youtube.com/watch?v=sxudIMiOo68

// -------------------------------------------------------------------
// #region New effects the game will need

export type GuessingGame = Print | Read | GenerateSecret

export class Print extends Effect('examples/basic/guessing-game/Print')<[string], void> { }

export class Read extends Effect('examples/basic/guessing-game/Read')<[string], string> { }

const ParseInteger = scope<Control>()('examples/basic/guessing-game/ParseInteger')

export const toInteger = (s: string) => {
  const i = Number.parseInt(s, 10)
  return Number.isInteger(i) ? ok(i) : abort(ParseInteger)
}

export class GenerateSecret extends Effect('examples/basic/guessing-game/GenerateSecret')<[number], number> { }

// #endregion

// -------------------------------------------------------------------
// The game

// Core "business logic": evaluate the user's guess
export const checkAnswer = (secret: number, guess: number): boolean =>
  secret === guess

// Main game loop. Play round after round until the user chooses to quit
export const main = fx(function* ({ max }: { readonly max: number }) {
  const name = yield* Read.of(`What's your name? `)
  yield* Print.of(`Hello, ${name}. Welcome to the game!`)

  do
    yield* play(name, max)
  while (yield* checkContinue(name))

  yield* Print.of(`Thanks for playing, ${name}.`)
})

// Play one round of the game.  Generate a number and ask the user
// to guess it.
const play = (name: string, max: number) => fx(function* () {
  // It doesn't actually matter whether we generate the number before
  // or after the user guesses, but we'll do it here
  const secret = yield* GenerateSecret.of(max)

  const result = yield* Read.of(`Dear ${name}, please guess a number from 1 to ${max}: `)

  const guess = yield* toInteger(result).pipe(withScope(ParseInteger), orReturn(ParseInteger, undefined))
  if (typeof guess !== 'number')
    yield* Print.of('You did not enter an integer!')
  else if (checkAnswer(secret, guess))
    yield* Print.of(`You guessed right, ${name}!`)
  else
    yield* Print.of(`You guessed wrong, ${name}! The number was: ${secret}`)
})

// Ask the user if they want to play again.
// Note that we keep asking until the user gives an answer we recognize
const checkContinue = (name: string) => fx(function* () {
  while (true) {
    const answer = yield* Read.of(`Do you want to continue, ${name}? (y/n) `)
    switch (answer.trim().toLowerCase()) {
      case 'y': return true
      case 'n': return false
      default: yield* Print.of('Please enter y or n.')
    }
  }
})
