import { Effect } from '../Effect.js'

export class InterruptMaskBegin extends Effect('fx/internal/InterruptMaskBegin')<void, void> { }
export class InterruptMaskEnd extends Effect('fx/internal/InterruptMaskEnd')<void, void> { }

export const isInterruptMaskEffect = (effect: unknown): effect is InterruptMaskBegin | InterruptMaskEnd =>
  InterruptMaskBegin.is(effect) || InterruptMaskEnd.is(effect)
