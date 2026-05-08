export type TraceCapturePolicy = 'full' | 'labels' | 'off'

let traceCapturePolicy: TraceCapturePolicy = 'full'

export const getTraceCapturePolicy = (): TraceCapturePolicy =>
  traceCapturePolicy

export const setTraceCapturePolicy = (policy: TraceCapturePolicy): TraceCapturePolicy => {
  const previous = traceCapturePolicy
  traceCapturePolicy = policy
  return previous
}
