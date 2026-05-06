import { fx, runPromise } from '../../src'
import { all, bounded, defaultAll } from '../../src/Concurrent'
import { sleep, defaultTime } from '../../src/Time'

// Number of tasks to fork
const tasks = 4

// Max number of tasks to allow to run concurrently
// Setting this to n >= tasks will run all tasks concurrently
// Setting this to n < tasks will allow at most n tasks in flight at a time
const concurrency = 2

let count = 0
const delay = fx(function* () {
  yield* sleep(1000)
  console.log(++count, new Date().toISOString())
})

const delays = Array.from({ length: tasks }, () => delay)

const main = fx(function* () {
  return yield* all(delays)
})

main.pipe(
  defaultAll,
  bounded(concurrency),
  defaultTime,
  runPromise
).catch(console.error)
