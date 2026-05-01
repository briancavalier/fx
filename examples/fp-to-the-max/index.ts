// -------------------------------------------------------------------
// Handlers for all the effects the game needs.
// The type system will prevent running the game until implementations
// of all capabilities have been provided.

import { createInterface } from 'node:readline/promises'

import { Fx, assertSync, bracket, fx, handle, ok, runPromise } from '../../src'
import { assertPromise } from '../../src/Async'
import { provide } from '../../src/Env'
import { int, defaultRandom } from '../../src/Random'

import { GenerateSecret, Print, Read, main } from './main'

const handlePrint = handle(Print, s => ok(console.log(s)))

const handleRead = <E, A>(f: Fx<E, A>) => bracket(
  assertSync(() => createInterface({ input: process.stdin, output: process.stdout })),
  readline => ok(readline.close()),
  readline => f.pipe(
    handle(Read, prompt => assertPromise(signal => readline.question(prompt, { signal })))
  ))

const handleGenerateSecret = handle(GenerateSecret, max => fx(function* () {
  return 1 + (yield* int(max))
}))

const { max = 10 } = process.env

main.pipe(
  provide({ max: +max }),
  handleGenerateSecret,
  defaultRandom(),
  handlePrint,
  handleRead,
  runPromise
)
