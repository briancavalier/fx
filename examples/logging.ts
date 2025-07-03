import { Fork, Log, Time, fx, runPromise } from "../src"

const f = (index: number) => fx(function* () {
  yield* Log.info('This is an info message')
  yield* Log.warn('This is a warning message')
  // yield* Time.sleep(index) // Simulate some work
  yield* Log.error('This is an error message', { errorInfo: 'Some error information' })
  yield* Log.debug('This is a debug message', { debugInfo: 'Some debug information' })
  return index
})

const main = fx(function* () {
  let i = 0
  while (i < 1000) {
    yield* Log.info('Running iteration', { iteration: i })
    yield* f(i).pipe(Log.child(`iteration-${i}`, { iteration: i }))

    i++
  }
  yield* Log.info('Done')
})

Fork.all([
  main.pipe(Log.child('main1', { contextInfo: 'Context for main1' })),
  main.pipe(Log.child('main2', { contextInfo: 'Context for main2' })),
]).pipe(
  Log.console,
  Time.defaultTime,
  Fork.unbounded,
  runPromise
)
