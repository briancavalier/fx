import { fx, runPromise } from '../../src'
import { defaultConsole, log } from '../../src/Console'
import { get, provide } from '../../src/Env'
import { WeatherQuery, getWeather } from './wttr'
import { wttrFetch } from './wttr-fetch'

const main = fx(function* () {
  const query = yield* get<WeatherQuery>()

  const response = yield* getWeather(query)

  yield* log(`Weather: `, response)
})

main.pipe(
  wttrFetch,
  defaultConsole,
  provide({ location: process.env.location }),
  runPromise
)
