import { Effect } from '../../src'

export type WeatherQuery = {
  readonly location?: string
}

export type Weather = {
  readonly weather: readonly Conditions[]
}

export type Conditions = {
  readonly date: string,
  readonly avgTempF: string
}

export class GetWeather extends Effect('Wttr/GetWeather')<WeatherQuery, Weather> { }

export const getWeather = (params: WeatherQuery) => new GetWeather(params)
