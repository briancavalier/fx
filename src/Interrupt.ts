import { Fx, fx } from './Fx.js'
import { InterruptMaskBegin, InterruptMaskEnd } from './internal/interrupt.js'

export type Interrupt = InterruptMaskBegin | InterruptMaskEnd

export type RestoreInterrupt = <const E, const A>(fx: Fx<E, A>) => Fx<E | Interrupt, A>

export const uninterruptible = <const E, const A>(fx: Fx<E, A>): Fx<E | Interrupt, A> =>
  mask(fx)

export const uninterruptibleMask = <const E, const A>(
  f: (restore: RestoreInterrupt) => Fx<E, A>
): Fx<E | Interrupt, A> =>
  mask(f(restore))

const mask = <const E, const A>(f: Fx<E, A>): Fx<E | Interrupt, A> => fx(function* () {
  yield* new InterruptMaskBegin()
  try {
    return yield* f
  } finally {
    yield* new InterruptMaskEnd()
  }
})

const restore = <const E, const A>(f: Fx<E, A>): Fx<E | Interrupt, A> => fx(function* () {
  yield* new InterruptMaskEnd()
  try {
    return yield* f
  } finally {
    yield* new InterruptMaskBegin()
  }
})
