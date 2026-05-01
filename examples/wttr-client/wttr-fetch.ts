import { handle } from '../../src'
import { assertPromise } from '../../src/Async'
import * as wttr from './wttr'

export const wttrFetch = handle(wttr.GetWeather, ({ location }) =>
  assertPromise(signal =>
    fetch(`https://wttr.in/${encodeURIComponent(location ?? '')}?format=j1`, { signal })
      .then(res => res.json() as Promise<wttr.Weather>)
  ))
