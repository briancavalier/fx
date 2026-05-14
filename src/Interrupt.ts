import { Fx, fx } from './Fx.js'
import { InterruptMaskBegin, InterruptMaskEnd, interruptMaskToken, type InterruptMaskToken } from './internal/interrupt.js'

export type Interrupt = InterruptMaskBegin | InterruptMaskEnd

export type RestoreInterrupt = <const E, const A>(fx: Fx<E, A>) => Fx<E | Interrupt, A>

export const uninterruptible = <const E, const A>(fx: Fx<E, A>): Fx<E | Interrupt, A> =>
  mask(() => fx)

export const uninterruptibleMask = <const E, const A>(
  f: (restore: RestoreInterrupt) => Fx<E, A>
): Fx<E | Interrupt, A> =>
  mask(token => f(restore(token)))

const mask = <const E, const A>(
  f: (token: InterruptMaskToken) => Fx<E, A>
): Fx<E | Interrupt, A> => fx(function* () {
  const token = interruptMaskToken()
  yield* new InterruptMaskBegin(token)
  try {
    return yield* f(token)
  } finally {
    yield* new InterruptMaskEnd(token)
  }
})

const restore = (token: InterruptMaskToken): RestoreInterrupt =>
  <const E, const A>(f: Fx<E, A>): Fx<E | Interrupt, A> => fx(function* () {
    yield* new InterruptMaskEnd(token)
    try {
      return yield* f
    } finally {
      yield* new InterruptMaskBegin(token)
    }
  })
