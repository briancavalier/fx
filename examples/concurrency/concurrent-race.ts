import { setTimeout } from 'node:timers/promises'
import { flatMap, fx, runPromise } from '../../src'
import { firstSettled, race, unbounded } from '../../src/Concurrent'
import { int, defaultRandom } from '../../src/Random'
import { sleep, defaultTime } from '../../src/Time'

const randomWait = () => Math.floor(Math.random() * 100)

const delayPromise = async (message: string) => {
  await setTimeout(randomWait())
  console.log(message)
}

// By default, Promise.race allows the losing tasks to continue after
// the race has been won. This can lead to unexpected behavior and
// resource leaks.
Promise.race([
  delayPromise('Promise A'),
  delayPromise('Promise B'),
]).then(_ => console.log('Promise done'), console.error)

const delayFx = (message: string) => fx(function* () {
  yield* int(100).pipe(flatMap(sleep))
  console.log(message)
})

// In contrast, race will cancel the losing tasks when the race
// has been won, ensuring that resources are cleaned up.
race([
  delayFx('Fx A'),
  delayFx('Fx B'),
]).pipe(
  firstSettled,
  defaultTime,
  defaultRandom(),
  unbounded,
  runPromise
).then(_ => console.log('Fx done'), console.error)
