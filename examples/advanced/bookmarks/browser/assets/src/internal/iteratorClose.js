let interpretingReturn = false;
export class InterruptedReturn {
    _tag = 'fx/InterruptedReturn';
}
export const isInterruptedReturn = (e) => e instanceof InterruptedReturn;
export function* drainIteratorReturn(iterator, step) {
    const ir = iterator.return?.();
    if (ir === undefined)
        return undefined;
    return yield* step(ir);
}
export function* drainRuntimeIteratorReturn(iterator, step) {
    if (!isInterpretingReturn())
        return undefined;
    return yield* drainIteratorReturn(iterator, step);
}
export const withInterpretedReturn = (f) => {
    // Runtime interruption closes generators by calling iterator.return(). A
    // generator can yield cleanup effects from finally while return() is on the
    // stack, so the flag is intentionally synchronous-only: wrappers may drain
    // those yielded effects only for this runtime close path, not for ordinary
    // user-level control flow or other iterator switching.
    const previous = interpretingReturn;
    interpretingReturn = true;
    try {
        return f();
    }
    finally {
        interpretingReturn = previous;
    }
};
export const isInterpretingReturn = () => interpretingReturn;
