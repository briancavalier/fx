import type { Breadcrumb } from '../Breadcrumb.js'
import { Fail } from '../Fail.js'
import { attachTrace, captureAppendTrace, capturePrependTrace, captureTrace } from '../Trace.js'
import type { Trace, TraceFrameMetadata } from '../Trace.js'
import type { RuntimeContext } from './runtimeContext.js'
import { getRuntimeContext, traceCapturePolicy, withActiveRuntimeContext } from './runtimeContext.js'

export class ForkError extends Error {
  constructor(readonly code: ForkErrorCode, message: string, origin: Breadcrumb, trace: Trace | undefined, runtimeContext?: RuntimeContext, options?: ErrorOptions) {
    super(message, options)
    if (traceCapturePolicy(runtimeContext) === 'full' && 'stack' in origin) Object.defineProperty(this, 'stack', { get: () => origin.stack })
    Object.defineProperty(this, 'code', {
      value: code,
      enumerable: false,
      writable: false,
      configurable: true
    })
    if (trace !== undefined) attachTrace(this, trace)
  }
}

export type ForkErrorCode = 'FX_AWAITED_ASYNC_FAILED' | 'FX_UNHANDLED_FORK_FAILURE' | 'FX_UNHANDLED_FAILURE' | 'FX_UNHANDLED_EXCEPTION'

export const runtimeContextOfEffect = (effect: unknown, fallback?: RuntimeContext): RuntimeContext | undefined =>
  getRuntimeContext(effect) ?? fallback

export const traceWithCause = (
  trace: Trace | undefined,
  cause: unknown,
  runtimeContext: RuntimeContext | undefined,
  causeTrace: Trace | undefined
): Trace | undefined =>
  captureAppendTraceWithContext(runtimeContext, causeTrace ?? trace, causeTrace === undefined ? undefined : trace)

export const traceUnhandledFail = (
  fail: Fail<unknown>,
  causeTrace: Trace | undefined,
  parentTrace: Trace | undefined,
  runtimeContext?: RuntimeContext
): Trace | undefined => {
  if (causeTrace !== undefined) return captureAppendTraceWithContext(runtimeContext, causeTrace, parentTrace)
  if (fail.trace === undefined) return captureAppendTraceWithContext(runtimeContext, undefined, parentTrace)
  return parentTrace === undefined
    ? fail.trace
    : captureAppendTraceWithContext(runtimeContext, fail.trace, parentTrace) ?? fail.trace
}

export const originOfUnhandledFail = (fail: Fail<unknown>, causeTrace: Trace | undefined): Breadcrumb =>
  causeTrace === undefined ? fail.origin : originFromTrace(causeTrace)

export const forkFrameMetadata = (trace: Trace | undefined): TraceFrameMetadata => ({
  kind: trace?.frame.kind ?? 'fork',
  index: trace?.frame.index
})

export const captureTraceWithContext = (
  context: RuntimeContext | undefined,
  origin: Breadcrumb,
  parent?: Trace,
  metadata?: TraceFrameMetadata
): Trace | undefined =>
  context === undefined
    ? captureTrace(origin, parent, metadata)
    : withActiveRuntimeContext(context, () => captureTrace(origin, parent, metadata))

export const capturePrependTraceWithContext = (
  context: RuntimeContext | undefined,
  origin: Breadcrumb,
  parent?: Trace,
  metadata?: TraceFrameMetadata
): Trace | undefined =>
  context === undefined
    ? capturePrependTrace(origin, parent, metadata)
    : withActiveRuntimeContext(context, () => capturePrependTrace(origin, parent, metadata))

export const captureAppendTraceWithContext = (
  context: RuntimeContext | undefined,
  trace: Trace | undefined,
  parent?: Trace
): Trace | undefined =>
  context === undefined
    ? captureAppendTrace(trace, parent)
    : withActiveRuntimeContext(context, () => captureAppendTrace(trace, parent))

export const originFromTrace = (trace: Trace): Breadcrumb => ({
  message: trace.frame.message,
  get stack() {
    return trace.frame.stackSource?.stack
  }
})
