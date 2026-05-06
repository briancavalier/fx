import { fx, runPromise } from "../src"
import { all, defaultAll, unbounded } from "../src/Concurrent"
import { child, console as logConsole, debug, error, info, warn } from "../src/Log"
import { defaultTime } from "../src/Time"

const f = (index: number) => fx(function* () {
  yield* info('This is an info message')
  yield* warn('This is a warning message')
  // Simulate some work here if needed
  yield* error('This is an error message', { errorInfo: 'Some error information' })
  yield* debug('This is a debug message', { debugInfo: 'Some debug information' })
  return index
})

const main = fx(function* () {
  let i = 0
  while (i < 10) {
    yield* info('Running iteration', { iteration: i })
    yield* f(i).pipe(child(`iteration-${i}`, { iteration: i }))

    i++
  }
  yield* info('Done')
})

await all([
  main.pipe(child('main1', { contextInfo: 'Context for main1' })),
  main.pipe(child('main2', { contextInfo: 'Context for main2' })),
]).pipe(
  logConsole,
  defaultTime,
  defaultAll,
  unbounded,
  runPromise
)
