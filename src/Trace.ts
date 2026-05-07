import { Breadcrumb } from './Breadcrumb.js'
import {
  capturesTrace,
  getTraceCapturePolicy,
  setTraceCapturePolicy
} from './internal/tracePolicy.js'
import type { TraceCapturePolicy } from './internal/tracePolicy.js'

export type { TraceCapturePolicy }
export { getTraceCapturePolicy, setTraceCapturePolicy }

export const MaxTraceDepth = 32

export const TraceTypeId = Symbol.for('fx/Trace')

export interface StackSource {
  readonly stack?: string
}

export interface TraceFrame {
  readonly message: string
  readonly stackSource?: StackSource
}

export interface Trace {
  readonly frame: TraceFrame
  readonly parent?: Trace
  readonly depth: number
  readonly truncated: boolean
  readonly acyclic?: true
}

export const traceFrom = (origin: Breadcrumb, parent?: Trace): Trace =>
  prependTrace(origin, parent)

export const captureTrace = (origin: Breadcrumb, parent?: Trace): Trace | undefined =>
  capturesTrace() ? prependTrace(origin, parent) : undefined

export const prependTrace = (origin: Breadcrumb, parent?: Trace): Trace =>
  prependFrame({ message: origin.message, stackSource: origin }, parent)

export const capturePrependTrace = (origin: Breadcrumb, parent?: Trace): Trace | undefined =>
  capturesTrace() ? prependTrace(origin, parent) : parent

export const appendTrace = (trace: Trace, parent?: Trace): Trace => {
  if (parent === undefined) return trace
  if (trace.acyclic && parent.acyclic && !trace.truncated && !parent.truncated && trace.depth + parent.depth <= MaxTraceDepth) {
    return appendTraceFast(trace, parent)
  }

  const frames: TraceFrame[] = []
  let truncated = trace.truncated || parent.truncated
  const seen = new Set<Trace>()

  const roots = [trace, parent]
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i]
    let current: Trace | undefined = root
    while (current !== undefined && !seen.has(current) && frames.length < MaxTraceDepth) {
      seen.add(current)
      frames.push(current.frame)
      current = current.parent
    }

    if (current !== undefined) truncated = true
    if (frames.length >= MaxTraceDepth) {
      if (i < roots.length - 1) truncated = true
      break
    }
  }

  return fromFrames(frames, truncated)
}

export const captureAppendTrace = (trace: Trace | undefined, parent?: Trace): Trace | undefined => {
  if (!capturesTrace()) return undefined
  if (trace === undefined) return parent
  return appendTrace(trace, parent)
}

export const attachTrace = (error: object, trace: Trace): void => {
  Object.defineProperty(error, TraceTypeId, {
    value: trace,
    enumerable: false,
    writable: false,
    configurable: true
  })
}

export const getTrace = (error: unknown): Trace | undefined =>
  typeof error === 'object' && error !== null
    ? (error as Partial<Record<typeof TraceTypeId, Trace>>)[TraceTypeId]
    : undefined

export const formatTrace = (trace: Trace): string => {
  const lines: string[] = []
  const seen = new Set<Trace>()

  let current: Trace | undefined = trace
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    lines.push(`  at ${current.frame.message}`)

    const location = firstStackFrame(current.frame.stackSource?.stack)
    if (location !== undefined) lines.push(`     ${location}`)

    current = current.parent
  }

  if (current !== undefined) lines.push('  <trace cycle detected>')
  else if (trace.truncated) lines.push('  <trace truncated; older frames omitted>')

  return lines.join('\n')
}

export const formatError = (error: unknown): string => {
  const trace = getTrace(error)
  if (trace === undefined) return formatErrorValue(error)

  return `${formatErrorValue(rootCause(error))}\n${formatTrace(trace)}`
}

const prependFrame = (frame: TraceFrame, parent?: Trace): Trace => {
  if (parent === undefined) return { frame, depth: 1, truncated: false, acyclic: true }
  if (parent.depth < MaxTraceDepth) {
    return {
      frame,
      parent,
      depth: parent.depth + 1,
      truncated: parent.truncated,
      acyclic: parent.acyclic
    }
  }

  const frames = [frame]
  let current: Trace | undefined = parent
  while (current !== undefined && frames.length < MaxTraceDepth) {
    frames.push(current.frame)
    current = current.parent
  }

  return fromFrames(frames, true)
}

const fromFrames = (frames: readonly TraceFrame[], truncated: boolean): Trace => {
  let trace: Trace | undefined

  for (let i = frames.length - 1; i >= 0; i--) {
    trace = {
      frame: frames[i],
      parent: trace,
      depth: (trace?.depth ?? 0) + 1,
      truncated,
      acyclic: true
    }
  }

  return trace as Trace
}

const appendTraceFast = (trace: Trace, parent: Trace): Trace => {
  const frames: TraceFrame[] = []
  let current: Trace | undefined = trace

  while (current !== undefined) {
    frames.push(current.frame)
    current = current.parent
  }

  current = parent
  while (current !== undefined) {
    frames.push(current.frame)
    current = current.parent
  }

  return fromFrames(frames, false)
}

const firstStackFrame = (stack: string | undefined): string | undefined => {
  if (stack === undefined) return undefined

  const lines = stack.split('\n')
  return lines.length > 1 ? lines[1].trim() : undefined
}

const rootCause = (error: unknown): unknown => {
  const seen = new Set<unknown>()
  let current = error

  while (hasCause(current) && !seen.has(current.cause)) {
    seen.add(current)
    current = current.cause
  }

  return current
}

const hasCause = (error: unknown): error is { readonly cause: unknown } =>
  typeof error === 'object' && error !== null && 'cause' in error

const formatErrorValue = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message === '' ? error.name : `${error.name}: ${error.message}`
  }

  return String(error)
}
