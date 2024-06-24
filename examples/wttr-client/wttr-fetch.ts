import { Async, handle } from '../../src'
import * as wttr from './wttr'

export const wttrFetch = handle(wttr.GetWeather, ({ location }) =>
  Async.assertPromise(signal =>
    fetch(`https://wttr.in/${encodeURIComponent(location ?? '')}?format=j1`, { signal })
      .then(res => res.json() as Promise<wttr.Weather>)
  ))
