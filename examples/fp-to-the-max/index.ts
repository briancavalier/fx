// -------------------------------------------------------------------
// Handlers for all the effects the game needs.
// The type system will prevent running the game until implementations
// of all capabilities have been provided.

import { createInterface } from 'node:readline/promises';

import { Async, Env, Fx, Random } from '../../src';

import { GenerateSecret, Print, Read, main } from './main';

const handlePrint = Fx.handle(Print, s => Fx.ok(console.log(s)));

const handleRead = <E, A>(f: Fx.Fx<E, A>) =>
  Fx.bracket(
    Fx.sync(() =>
      createInterface({ input: process.stdin, output: process.stdout })
    ),
    readline => Fx.ok(readline.close()),
    readline =>
      f.pipe(
        Fx.handle(Read, prompt =>
          Async.run(signal => readline.question(prompt, { signal }))
        )
      )
  );

const handleGenerateSecret = Fx.handle(GenerateSecret, max =>
  Fx.fx(function* () {
    return 1 + (yield* Random.int(max));
  })
);

const { max = 10 } = process.env;

main.pipe(
  Env.provide({ max: +max }),
  handleGenerateSecret,
  Random.defaultRandom(),
  handlePrint,
  handleRead,
  Fx.runAsync
);
