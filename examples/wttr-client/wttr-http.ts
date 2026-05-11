import { flatMap, handle, map } from '../../src'
import { expectSuccess, json, request } from '../../src/HttpClient'
import { GetWeather, Weather } from './wttr'

export const wttrHttp = handle(GetWeather, ({ arg: { location } }) =>
  request({
    url: new URL(`https://wttr.in/${encodeURIComponent(location ?? '')}?format=j1`),
    headers: [['accept', 'application/json']]
  })
    .pipe(
      flatMap(expectSuccess),
      flatMap(json),
      map(data => data as Weather)
    ))
