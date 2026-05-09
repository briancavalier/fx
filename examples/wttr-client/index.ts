import { fx, runPromise } from '../../src'
import { defaultConsole, log } from '../../src/Console'
import { provide } from '../../src/Env'
import { assert as assertNoFail } from '../../src/Fail'
import { w3cFetch } from '../../src/HttpClient'
import { WeatherQuery, getWeather } from './wttr'
import { wttrHttp } from './wttr-http'

const main = fx(function* (query: WeatherQuery) {
  const response = yield* getWeather(query)

  yield* log(`Weather: `, response)
})

await main.pipe(
  wttrHttp,
  w3cFetch(),
  assertNoFail,
  defaultConsole,
  provide({ location: process.env.location }),
  runPromise
)
