// -------------------------------------------------------------------
// Handlers for all the effects the game needs.
// The type system will prevent running the game until implementations
// of all capabilities have been provided.

import { createInterface } from 'node:readline/promises'

import { assertPromise, assertSync, bracket, fx, Fx, handle, ok, provide, runPromise } from '@briancavalier/fx'

import { int, defaultRandom } from '@briancavalier/fx/random'

import { GuessingGame, main } from './main.js'

const handlePrint = handle(GuessingGame.print, print => ok(console.log(print.arg)))

const handleRead = <E, A>(f: Fx<E, A>) => bracket(
  assertSync(() => createInterface({ input: process.stdin, output: process.stdout })),
  readline => ok(readline.close()),
  readline => f.pipe(
    handle(GuessingGame.read, read => assertPromise(signal => readline.question(read.arg, { signal })))
  ))

const handleGenerateSecret = handle(GuessingGame.generateSecret, max => fx(function* () {
  return 1 + (yield* int(max.arg))
}))

const { max = 10 } = process.env

await main.pipe(
  provide({ max: +max }),
  handleGenerateSecret,
  defaultRandom(),
  handlePrint,
  handleRead,
  runPromise
)
