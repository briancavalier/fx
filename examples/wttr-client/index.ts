import { Console, Env, fx, runPromise } from '../../src'
import { WeatherQuery, getWeather } from './wttr'
import { wttrFetch } from './wttr-fetch'

const main = fx(function* () {
  const query = yield* Env.get<WeatherQuery>()

  const response = yield* getWeather(query)

  yield* Console.log(`Weather: `, response)
})

main.pipe(
  wttrFetch,
  Console.defaultConsole,
  Env.provide({ location: process.env.location }),
  runPromise
)
