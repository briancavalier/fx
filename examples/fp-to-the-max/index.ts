// -------------------------------------------------------------------
// Handlers for all the effects the game needs.
// The type system will prevent running the game until implementations
// of all capabilities have been provided.

import { createInterface } from 'node:readline/promises'

import { Fx, assertSync, bracket, fx, handle, ok, runPromise } from '../../src/index.js'
import { assertPromise } from '../../src/Async.js'
import { provide } from '../../src/Env.js'
import { int, defaultRandom } from '../../src/Random.js'

import { GenerateSecret, Print, Read, main } from './main.js'

const handlePrint = handle(Print, print => ok(console.log(print.arg)))

const handleRead = <E, A>(f: Fx<E, A>) => bracket(
  assertSync(() => createInterface({ input: process.stdin, output: process.stdout })),
  readline => ok(readline.close()),
  readline => f.pipe(
    handle(Read, read => assertPromise(signal => readline.question(read.arg, { signal })))
  ))

const handleGenerateSecret = handle(GenerateSecret, max => fx(function* () {
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
