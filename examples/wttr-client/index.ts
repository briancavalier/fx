import { Env, Log, Fx } from '../../src';
import * as wttr from './wttr';
import { wttrFetch } from './wttr-fetch';

const main = Fx.fx(function* () {
  const request = yield* Env.get<wttr.WeatherQuery>();

  const response = yield* wttr.getWeather(request);

  yield* Log.info('Weather: ', response);
});

main.pipe(
  wttrFetch,
  Log.console,
  Env.provide({ location: process.env.location }),
  Fx.runAsync
);
