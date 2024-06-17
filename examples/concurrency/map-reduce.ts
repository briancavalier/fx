import { setTimeout } from 'node:timers/promises';
import { Async, Fork, Fx, Task, Time } from '../../src';

// Concurrent map-reduce
// Splits the input in half and runs mapReduce on each half concurrently
const mapReduce = <A, B, EM, ER>(
  inputs: readonly A[],
  map: (a: A) => Fx.Fx<EM, B>,
  reduce: (b1: B, b2: B) => Fx.Fx<ER, B>,
  init: B
): Fx.Fx<Async.Async | Fork.Fork | EM | ER, B> =>
  Fx.fx(function* () {
    if (inputs.length === 0) return init;
    if (inputs.length === 1) return yield* map(inputs[0]);

    const half = Math.floor(inputs.length / 2);
    const [l, r] = [inputs.slice(0, half), inputs.slice(half)];

    const [rl, rr] = yield* Task.wait(
      yield* Fork.all([
        mapReduce(l, map, reduce, init),
        mapReduce(r, map, reduce, init),
      ])
    );

    return yield* reduce(rl, rr);
  });

// Simulate a long running computation or network request
// for the mapping operation
const delay = <const A>(ms: number, a: A) =>
  Time.sleep(ms).pipe(Fx.map(_ => a));

// Generate inputs
const inputs = Array.from({ length: 1000 }, (_, i) => i);

// Run concurrent map-reduce
// This should take a little over 1 second, not inputs.length seconds
const start = performance.now();
mapReduce(
  inputs,
  i => delay(1000, i + 1),
  (a, b) => Fx.ok(a + b),
  0
)
  .pipe(Time.defaultTime, Fork.unbounded, Fx.runAsync)
  .promise.then(result =>
    console.log(`result: ${result}, elapsed: ${performance.now() - start}ms`)
  );
