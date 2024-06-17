import { Fork, Task, Time, Fx } from '../../src';

// Number of tasks to fork
const tasks = 4;

// Max number of tasks to allow to run concurrently
// Setting this to n >= tasks will run all tasks concurrently
// Setting this to n < tasks will allow at most n tasks in flight at a time
const concurrency = 2;

let count = 0;
const delay = Fx.fx(function* () {
  yield* Time.sleep(1000);
  console.log(++count, new Date().toISOString());
});

const delays = Array.from({ length: tasks }, () => delay);

const main = Fx.fx(function* () {
  const t1 = yield* Fork.all(delays);
  const r = yield* Task.wait(t1);
  return r;
});

main
  .pipe(Fork.bounded(concurrency), Time.defaultTime, Fx.runAsync)
  .promise.catch(console.error);
