
import { createInterface } from 'node:readline/promises'

import { Async, Effect, Fx, bracket, fx, handle, ok, runToTask, sync } from '../src'

class Print extends Effect('Print')<string, void> { }

const print = (s: string) => new Print(s)

class Read extends Effect('Read')<string, string> { }

const read = (prompt: string) => new Read(prompt)

const main = fx(function* () {
  while (true) {
    const x = yield* read('echo> ')
    if (!x) return
    yield* print(x)
  }
})

const handlePrint = handle(Print, s => ok(console.log(s)))

const handleRead = <E, A>(f: Fx<E, A>) => bracket(
  sync(() => createInterface({ input: process.stdin, output: process.stdout })),
  readline => ok(readline.close()),
  readline => f.pipe(
    handle(Read, prompt => Async.promise(signal => readline.question(prompt, { signal })))
  ))

// Run with "real" Read and Print effects
main.pipe(handleRead, handlePrint, runToTask)
  .promise.then(console.log)

// const handlePrintPure = <E, A>(f: Fx<E, A>) => {
//   const printed = [] as string[]
//   return f.pipe(
//     handle(Print, s => ok(void printed.push(s))),
//     map(_ => printed)
//   )
// }

// const handleReadPure = ([...inputs]: readonly string[]) =>
//   handle(Read, _ => ok(inputs.shift()!))

// // Run with pure Read and Print effects that only collect input and output
// main.pipe(handlePrintPure, handleReadPure(['a', 'b', 'c']), run)
//   .promise.then(console.log)
