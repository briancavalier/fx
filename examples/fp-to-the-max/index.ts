// -------------------------------------------------------------------
// Handlers for all the effects the game needs.
// The type system will prevent running the game until implementations
// of all capabilities have been provided.

import { createInterface } from 'node:readline/promises'

import { Async, Env, Fail, Fx, Random, bracket, fx, handle, ok, runPromise, trySync } from '../../src'

import { GenerateSecret, Print, Read, main } from './main'

const handlePrint = handle(Print, s => ok(console.log(s)))

const handleRead = <E, A>(f: Fx<E, A>) => bracket(
  trySync(() => createInterface({ input: process.stdin, output: process.stdout })).pipe(Fail.assert),
  readline => ok(readline.close()),
  readline => f.pipe(
    handle(Read, prompt => Async.tryPromise(signal => readline.question(prompt, { signal })).pipe(Fail.assert))
  ))

const handleGenerateSecret = handle(GenerateSecret, max => fx(function* () {
  return 1 + (yield* Random.int(max))
}))

const { max = 10 } = process.env

main.pipe(
  Env.provide({ max: +max }),
  handleGenerateSecret,
  Random.defaultRandom(),
  handlePrint,
  handleRead,
  runPromise
)
