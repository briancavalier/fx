import { Effect } from '../Effect.js';
export const interruptMaskToken = () => ({});
export class InterruptMaskBegin extends Effect('fx/internal/InterruptMaskBegin') {
}
export class InterruptMaskEnd extends Effect('fx/internal/InterruptMaskEnd') {
}
export class InterruptMaskState {
    masks = [];
    constructor(masks = []) {
        this.masks.push(...masks);
    }
    get canInterrupt() {
        return this.masks.length === 0;
    }
    get balanced() {
        return this.masks.length === 0;
    }
    snapshot() {
        return [...this.masks];
    }
    mask(token) {
        this.masks.push(token);
    }
    unmask(token) {
        const current = this.masks.at(-1);
        if (current !== token)
            throw interruptMaskInvariantFailed();
        this.masks.pop();
    }
    assertBalanced() {
        if (this.masks.length > 0)
            throw interruptMaskInvariantFailed();
    }
}
export const interruptMaskInvariantFailed = () => new Error('Interrupt mask invariant failed');
