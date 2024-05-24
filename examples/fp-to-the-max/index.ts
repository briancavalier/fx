// -------------------------------------------------------------------
// Handlers for all the effects the game needs.
// The type system will prevent running the game until implementations
// of all capabilities have been provided.

import { createInterface } from 'node:readline/promises'

import { Async, Env, Fx, Random, bracket, handle, ok, runAsync, sync } from '../../src'

import { Print, Read, main } from './main'

const handlePrint = handle(Print, s => ok(console.log(s)))

const handleRead = <E, A>(f: Fx<E, A>) => bracket(
  sync(() => createInterface({ input: process.stdin, output: process.stdout })),
  readline => ok(readline.close()),
  readline => f.pipe(
    handle(Read, prompt => Async.run(signal => readline.question(prompt, { signal })))
  ))

const { max = 10 } = process.env

main.pipe(
  Env.provide({ max: +max }),
  Random.xoroshiro128plus(Date.now()),
  handlePrint,
  handleRead,
  runAsync
)
