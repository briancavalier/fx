import { fx, runPromise } from '../../src/index.js'
import { defaultConsole, log } from '../../src/Console.js'
import { provide } from '../../src/Env.js'
import { assert as assertNoFail } from '../../src/Fail.js'
import { w3cFetch } from '../../src/HttpClient.js'
import { WeatherQuery, getWeather } from './wttr.js'
import { wttrHttp } from './wttr-http.js'

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
