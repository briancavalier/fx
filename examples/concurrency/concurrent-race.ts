import { setTimeout } from 'node:timers/promises'
import { Fork, Task, Time, flatMap, fx, runPromise } from '../../src'

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
  yield* Time.sleep(randomWait())
  console.log(message)
})

// In contrast, Fork.race will cancel the losing tasks when the race
// has been won, ensuring that resources are cleaned up.
Fork.race([
  delayFx('Fx A'),
  delayFx('Fx B'),
]).pipe(
  flatMap(Task.wait),
  Time.defaultTime,
  Fork.unbounded,
  runPromise
).then(_ => console.log('Fx done'), console.error)
