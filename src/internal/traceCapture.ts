import type { Breadcrumb } from '../Breadcrumb.js'
import { Trace, TraceFrameMetadata, appendTrace, prependTrace } from '../Trace.js'
import type { RuntimeContext } from './runtimeContext.js'
import { capturesTrace } from './runtimeContext.js'

export const captureTraceWith = (
  context: RuntimeContext | undefined,
  origin: Breadcrumb,
  parent?: Trace,
  metadata?: TraceFrameMetadata
): Trace | undefined =>
  capturesTrace(context) ? prependTrace(origin, parent, metadata) : undefined

export const capturePrependTraceWith = (
  context: RuntimeContext | undefined,
  origin: Breadcrumb,
  parent?: Trace,
  metadata?: TraceFrameMetadata
): Trace | undefined =>
  capturesTrace(context) ? prependTrace(origin, parent, metadata) : parent

export const captureAppendTraceWith = (
  context: RuntimeContext | undefined,
  trace: Trace | undefined,
  parent?: Trace
): Trace | undefined => {
  if (!capturesTrace(context)) return undefined
  if (trace === undefined) return parent
  return appendTrace(trace, parent)
}
