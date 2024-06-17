import { Async, Fx } from '../../src';
import * as wttr from './wttr';

export const wttrFetch = Fx.handle(wttr.GetWeather, ({ location }) =>
  Async.run(signal =>
    fetch(`https://wttr.in/${encodeURIComponent(location ?? '')}?format=j1`, {
      signal,
    }).then(res => res.json() as Promise<wttr.Weather>)
  )
);
