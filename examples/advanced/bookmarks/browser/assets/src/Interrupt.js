import { fx } from './Fx.js';
import { InterruptMaskBegin, InterruptMaskEnd, interruptMaskToken } from './internal/interrupt.js';
export const uninterruptible = (fx) => mask(() => fx);
export const uninterruptibleMask = (f) => mask(token => f(restore(token)));
const mask = (f) => fx(function* () {
    const token = interruptMaskToken();
    yield* new InterruptMaskBegin(token);
    try {
        return yield* f(token);
    }
    finally {
        yield* new InterruptMaskEnd(token);
    }
});
const restore = (token) => (f) => fx(function* () {
    yield* new InterruptMaskEnd(token);
    try {
        return yield* f;
    }
    finally {
        yield* new InterruptMaskBegin(token);
    }
});
