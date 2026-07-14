import { Effect } from '../Effect.js'

export type InterruptMaskToken = object

export const interruptMaskToken = (): InterruptMaskToken => ({})

export class InterruptMaskBegin extends Effect('fx/internal/InterruptMaskBegin')<[InterruptMaskToken], void> { }
export class InterruptMaskEnd extends Effect('fx/internal/InterruptMaskEnd')<[InterruptMaskToken], void> { }

export class InterruptMaskState {
  private readonly masks = [] as InterruptMaskToken[]

  constructor(masks: readonly InterruptMaskToken[] = []) {
    this.masks.push(...masks)
  }

  get canInterrupt() {
    return this.masks.length === 0
  }

  get balanced() {
    return this.masks.length === 0
  }

  snapshot(): readonly InterruptMaskToken[] {
    return [...this.masks]
  }

  mask(token: InterruptMaskToken) {
    this.masks.push(token)
  }

  unmask(token: InterruptMaskToken) {
    const current = this.masks.at(-1)
    if (current !== token) throw interruptMaskInvariantFailed()
    this.masks.pop()
  }

  assertBalanced() {
    if (this.masks.length > 0) throw interruptMaskInvariantFailed()
  }
}

export const interruptMaskInvariantFailed = () =>
  new Error('Interrupt mask invariant failed')
