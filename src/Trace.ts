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

export type TraceFrameKind = 'run' | 'fail' | 'async' | 'fork' | 'all' | 'race' | 'timeout' | 'retry'

export interface TraceFrameMetadata {
  readonly kind?: TraceFrameKind
  readonly index?: number
}

export interface TraceFrame {
  readonly message: string
  readonly stackSource?: StackSource
  readonly kind?: TraceFrameKind
  readonly index?: number
}

export interface Trace {
  readonly frame: TraceFrame
  readonly parent?: Trace
  readonly depth: number
  readonly truncated: boolean
  readonly acyclic?: true
}

export interface TraceLocation {
  readonly raw: string
  readonly functionName?: string
  readonly file?: string
  readonly line?: number
  readonly column?: number
}

export interface TraceSnapshotFrame {
  readonly message: string
  readonly kind?: TraceFrameKind
  readonly index?: number
  readonly location?: TraceLocation
}

export interface TraceSnapshot {
  readonly frames: readonly TraceSnapshotFrame[]
  readonly truncated: boolean
  readonly cycleDetected: boolean
}

export interface DiagnosticErrorSnapshot {
  readonly type: string
  readonly name?: string
  readonly message: string
  readonly code?: string
  readonly trace?: TraceSnapshot
  readonly cause?: DiagnosticErrorSnapshot
  readonly aggregate?: DiagnosticAggregateSnapshot
  readonly cycleDetected?: true
}

export interface DiagnosticAggregateSnapshot {
  readonly errors: readonly DiagnosticErrorSnapshot[]
}

export interface DiagnosticSnapshot extends DiagnosticErrorSnapshot { }

export const traceFrom = (origin: Breadcrumb, parent?: Trace, metadata?: TraceFrameMetadata): Trace =>
  prependTrace(origin, parent, metadata)

export const captureTrace = (origin: Breadcrumb, parent?: Trace, metadata?: TraceFrameMetadata): Trace | undefined =>
  capturesTrace() ? prependTrace(origin, parent, metadata) : undefined

export const prependTrace = (origin: Breadcrumb, parent?: Trace, metadata?: TraceFrameMetadata): Trace =>
  prependFrame({ message: origin.message, stackSource: origin, ...metadata }, parent)

export const capturePrependTrace = (origin: Breadcrumb, parent?: Trace, metadata?: TraceFrameMetadata): Trace | undefined =>
  capturesTrace() ? prependTrace(origin, parent, metadata) : parent

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

export const snapshotTrace = (trace: Trace): TraceSnapshot => {
  const frames: TraceSnapshotFrame[] = []
  const seen = new Set<Trace>()

  let current: Trace | undefined = trace
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)

    frames.push(snapshotFrame(current.frame))

    current = current.parent
  }

  return {
    frames,
    truncated: trace.truncated,
    cycleDetected: current !== undefined
  }
}

export const snapshotError = (error: unknown): DiagnosticSnapshot =>
  snapshotErrorValue(error, new Set())

export const formatTrace = (trace: Trace): string => {
  const lines: string[] = []
  const seen = new Set<Trace>()

  let current: Trace | undefined = trace
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    lines.push(`  at ${current.frame.message}`)

    const location = firstStackLocation(current.frame.stackSource?.stack)
    if (location !== undefined) lines.push(`     ${location.raw}`)

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

export const formatDiagnostic = (error: unknown): string => {
  const lines: string[] = []
  formatDiagnosticError(snapshotError(error), lines, 0)
  return lines.join('\n')
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

const firstStackLocation = (stack: string | undefined): TraceLocation | undefined => {
  if (stack === undefined) return undefined

  const lines = stack.split('\n')
  return lines.length > 1 ? parseStackLocation(lines[1].trim()) : undefined
}

const parseStackLocation = (raw: string): TraceLocation => {
  const trimmed = raw.replace(/^at\s+/, '')
  const call = /^(.*?) \((.*):(\d+):(\d+)\)$/.exec(trimmed)
  if (call !== null) {
    return {
      raw,
      functionName: call[1],
      file: call[2],
      line: Number(call[3]),
      column: Number(call[4])
    }
  }

  const location = /^(.*):(\d+):(\d+)$/.exec(trimmed)
  if (location !== null) {
    return {
      raw,
      file: location[1],
      line: Number(location[2]),
      column: Number(location[3])
    }
  }

  return { raw }
}

const snapshotFrame = (frame: TraceFrame): TraceSnapshotFrame => {
  const location = firstStackLocation(frame.stackSource?.stack)

  return {
    message: frame.message,
    ...(frame.kind === undefined ? {} : { kind: frame.kind }),
    ...(frame.index === undefined ? {} : { index: frame.index }),
    ...(location === undefined ? {} : { location })
  }
}

const snapshotErrorValue = (error: unknown, seen: Set<unknown>): DiagnosticErrorSnapshot => {
  if (tracksCycles(error) && seen.has(error)) return {
    type: typeOf(error),
    message: '[cycle]',
    cycleDetected: true
  }

  if (tracksCycles(error)) seen.add(error)

  const trace = getTrace(error)
  const base = error instanceof Error
    ? snapshotErrorObject(error)
    : {
        type: typeOf(error),
        message: String(error)
      }

  const cause = hasCause(error) ? error.cause : undefined
  const aggregate = aggregateErrors(error)

  return {
    ...base,
    ...(trace === undefined ? {} : { trace: snapshotTrace(trace) }),
    ...(cause === undefined ? {} : { cause: snapshotErrorValue(cause, seen) }),
    ...(aggregate === undefined ? {} : { aggregate: { errors: aggregate.map(e => snapshotErrorValue(e, seen)) } })
  }
}

const snapshotErrorObject = (error: Error): DiagnosticErrorSnapshot => ({
  type: error.constructor.name,
  name: error.name,
  message: error.message,
  ...('code' in error ? { code: String((error as { readonly code: unknown }).code) } : {})
})

const aggregateErrors = (error: unknown): readonly unknown[] | undefined => {
  if (error instanceof AggregateError) return Array.from(error.errors)

  if (
    error instanceof Error
    && error.name === 'RaceAllFailed'
    && 'errors' in error
    && Array.isArray((error as { readonly errors: unknown }).errors)
  ) return (error as { readonly errors: readonly unknown[] }).errors

  return undefined
}

const formatDiagnosticError = (error: DiagnosticErrorSnapshot, lines: string[], indent: number): void => {
  const prefix = ' '.repeat(indent)
  lines.push(`${prefix}${formatDiagnosticHeader(error)}`)

  if (error.trace !== undefined) {
    for (const frame of error.trace.frames) {
      lines.push(`${prefix}  at ${formatSnapshotFrame(frame)}`)
      if (frame.location !== undefined) lines.push(`${prefix}     ${formatTraceLocation(frame.location)}`)
    }

    if (error.trace.cycleDetected) lines.push(`${prefix}  <trace cycle detected>`)
    else if (error.trace.truncated) lines.push(`${prefix}  <trace truncated; older frames omitted>`)
  }

  if (error.cause !== undefined) {
    lines.push(`${prefix}Caused by:`)
    formatDiagnosticError(error.cause, lines, indent + 2)
  }

  if (error.aggregate !== undefined) {
    for (let i = 0; i < error.aggregate.errors.length; i++) {
      lines.push(`${prefix}Aggregate[${i}]:`)
      formatDiagnosticError(error.aggregate.errors[i], lines, indent + 2)
    }
  }
}

const formatDiagnosticHeader = (error: DiagnosticErrorSnapshot): string => {
  const code = error.code === undefined ? '' : ` [${error.code}]`
  const name = error.name ?? error.type
  return `${name}${code}${error.message === '' ? '' : `: ${error.message}`}`
}

const formatSnapshotFrame = (frame: TraceSnapshotFrame): string => {
  const metadata = [
    frame.kind === undefined ? undefined : `kind=${frame.kind}`,
    frame.index === undefined ? undefined : `index=${frame.index}`
  ].filter((s): s is string => s !== undefined)

  const suffix = metadata.length === 0 ? '' : ` (${metadata.join(', ')})`
  return `${frame.message}${suffix}`
}

const formatTraceLocation = (location: TraceLocation): string =>
  location.file === undefined
    ? location.raw
    : `${location.file}${location.line === undefined ? '' : `:${location.line}${location.column === undefined ? '' : `:${location.column}`}`}`

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

const typeOf = (value: unknown): string =>
  value === null ? 'null' : typeof value

const tracksCycles = (value: unknown): boolean =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'
