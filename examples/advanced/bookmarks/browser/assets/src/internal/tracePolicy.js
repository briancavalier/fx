let traceCapturePolicy = 'full';
export const getTraceCapturePolicy = () => traceCapturePolicy;
export const setTraceCapturePolicy = (policy) => {
    const previous = traceCapturePolicy;
    traceCapturePolicy = policy;
    return previous;
};
