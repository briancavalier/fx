import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { at } from './Breadcrumb.js'
import { fail } from './Fail.js'
import { runPromise } from './Fx.js'
import { MaxTraceDepth, appendTrace, attachTrace, captureTrace, formatDiagnostic, formatError, formatTrace, getTrace, getTraceCapturePolicy, prependTrace, setTraceCapturePolicy, snapshotError, snapshotTrace } from './Trace.js'
import type { Trace } from './Trace.js'
import type { Breadcrumb } from './Breadcrumb.js'

describe('Trace', () => {
  it('defaults to full stack capture', () => {
    assert.equal(getTraceCapturePolicy(), 'full')
  })

  it('setTraceCapturePolicy returns the previous policy', () => {
    const previous = setTraceCapturePolicy('labels')
    try {
      assert.equal(previous, 'full')
      assert.equal(setTraceCapturePolicy('full'), 'labels')
    } finally {
      setTraceCapturePolicy('full')
    }
  })

  it('labels policy preserves trace messages without stack locations', () => {
    const previous = setTraceCapturePolicy('labels')
    try {
      const trace = captureTrace(at('labels/frame'))

      assert.ok(trace !== undefined)
      assert.equal(formatTrace(trace), '  at labels/frame')
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('off policy avoids attaching runtime trace metadata', async () => {
    const previous = setTraceCapturePolicy('off')
    try {
      await assert.rejects(
        runPromise(fail(new Error('off')) as never),
        e => e instanceof Error && getTrace(e) === undefined
      )
    } finally {
      setTraceCapturePolicy(previous)
    }
  })

  it('prepends frames newest first', () => {
    const root = prependTrace(breadcrumb('root'))
    const trace = prependTrace(breadcrumb('child'), root)

    assert.equal(trace.frame.message, 'child')
    assert.equal(trace.parent?.frame.message, 'root')
    assert.equal(trace.depth, 2)
    assert.equal(trace.truncated, false)
  })

  it('caps trace depth and drops oldest frames', () => {
    let trace = prependTrace(breadcrumb('frame-0'))
    for (let i = 1; i < MaxTraceDepth + 5; i++) {
      trace = prependTrace(breadcrumb(`frame-${i}`), trace)
    }

    const messages = messagesOf(trace)

    assert.equal(trace.depth, MaxTraceDepth)
    assert.equal(trace.truncated, true)
    assert.deepEqual(messages.slice(0, 3), ['frame-36', 'frame-35', 'frame-34'])
    assert.equal(messages.at(-1), 'frame-5')
  })

  it('appends parent traces while preserving newest frames', () => {
    const trace = appendTrace(
      prependTrace(breadcrumb('child')),
      prependTrace(breadcrumb('parent'))
    )

    assert.deepEqual(messagesOf(trace), ['child', 'parent'])
  })

  it('caps appended traces and drops oldest frames', () => {
    let child = prependTrace(breadcrumb('child-0'))
    for (let i = 1; i < MaxTraceDepth; i++) child = prependTrace(breadcrumb(`child-${i}`), child)

    const trace = appendTrace(child, prependTrace(breadcrumb('parent')))

    assert.equal(trace.depth, MaxTraceDepth)
    assert.equal(trace.truncated, true)
    assert.equal(messagesOf(trace)[0], 'child-31')
    assert.equal(messagesOf(trace).includes('parent'), false)
  })

  it('does not read stack sources when constructing or trimming traces', () => {
    let reads = 0
    let trace = prependTrace(stackReadingBreadcrumb('frame-0', () => { reads += 1 }))

    for (let i = 1; i < MaxTraceDepth + 5; i++) {
      trace = prependTrace(stackReadingBreadcrumb(`frame-${i}`, () => { reads += 1 }), trace)
    }

    assert.equal(reads, 0)
    assert.equal(trace.depth, MaxTraceDepth)
  })

  it('reads stack sources when formatting traces', () => {
    let reads = 0
    const trace = prependTrace(stackReadingBreadcrumb('frame', () => { reads += 1 }))

    const formatted = formatTrace(trace)

    assert.equal(reads, 1)
    assert.match(formatted, /at frame/)
    assert.match(formatted, /Trace\.test\.ts/)
  })

  it('snapshots traces with metadata and lazily parsed stack locations', () => {
    let reads = 0
    const trace = prependTrace(
      stackReadingBreadcrumb('child', () => { reads += 1 }),
      prependTrace(breadcrumb('parent'), undefined, { kind: 'race' }),
      { kind: 'race', index: 1 }
    )

    assert.equal(reads, 0)

    const snapshot = snapshotTrace(trace)

    assert.equal(reads, 1)
    assert.equal(snapshot.truncated, false)
    assert.equal(snapshot.cycleDetected, false)
    assert.equal(snapshot.frames[0].message, 'child')
    assert.equal(snapshot.frames[0].kind, 'race')
    assert.equal(snapshot.frames[0].index, 1)
    assert.equal(snapshot.frames[0].location?.functionName, 'fake')
    assert.equal(snapshot.frames[0].location?.file, import.meta.filename)
    assert.equal(snapshot.frames[0].location?.line, 1)
    assert.equal(snapshot.frames[0].location?.column, 1)
    assert.equal(snapshot.frames[1].kind, 'race')
  })

  it('snapshots file-only stack locations and preserves unparsed raw locations', () => {
    const fileOnly = prependTrace(stackBreadcrumb('file', `Error: file\n    at file://${import.meta.filename}:2:3`))
    const unknown = prependTrace(stackBreadcrumb('unknown', 'Error: unknown\n    at native'))

    assert.equal(snapshotTrace(fileOnly).frames[0].location?.file, `file://${import.meta.filename}`)
    assert.equal(snapshotTrace(fileOnly).frames[0].location?.line, 2)
    assert.equal(snapshotTrace(fileOnly).frames[0].location?.column, 3)
    assert.equal(snapshotTrace(unknown).frames[0].location?.raw, 'at native')
    assert.equal(snapshotTrace(unknown).frames[0].location?.file, undefined)
  })

  it('detects cycles while formatting traces', () => {
    const trace = { frame: { message: 'cycle' }, depth: 1, truncated: false } as Trace & { parent?: Trace }
    trace.parent = trace

    assert.match(formatTrace(trace), /<trace cycle detected>/)
    assert.equal(snapshotTrace(trace).cycleDetected, true)
  })

  it('attaches trace metadata non-enumerably', () => {
    const trace = prependTrace(breadcrumb('frame'))
    const error = new Error('boom')

    attachTrace(error, trace)

    assert.equal(getTrace(error), trace)
    assert.deepEqual(Object.keys(error), [])
  })

  it('formats untraced errors as an error message', () => {
    assert.equal(formatError(new TypeError('boom')), 'TypeError: boom')
  })

  it('formats traced errors with root cause message and Fx trace', () => {
    const trace = prependTrace(breadcrumb('frame'))
    const cause = new Error('root failed')
    const error = new Error('wrapper failed', { cause })
    attachTrace(error, trace)

    assert.equal(formatError(error), [
      'Error: root failed',
      '  at frame'
    ].join('\n'))
  })

  it('snapshots errors with trace, cause, code, and aggregates', () => {
    const child = new TypeError('child failed')
    attachTrace(child, prependTrace(breadcrumb('child trace'), undefined, { kind: 'fail' }))

    const aggregate = new AggregateError([child, 'plain failure'], 'aggregate failed', { cause: new Error('root cause') })
    Object.defineProperty(aggregate, 'code', { value: 'TEST_AGGREGATE' })

    const snapshot = snapshotError(aggregate)

    assert.equal(snapshot.name, 'AggregateError')
    assert.equal(snapshot.code, 'TEST_AGGREGATE')
    assert.equal(snapshot.cause?.message, 'root cause')
    assert.equal(snapshot.aggregate?.errors.length, 2)
    assert.equal(snapshot.aggregate?.errors[0].trace?.frames[0].message, 'child trace')
    assert.equal(snapshot.aggregate?.errors[0].trace?.frames[0].kind, 'fail')
    assert.equal(snapshot.aggregate?.errors[1].type, 'string')
    assert.equal(snapshot.aggregate?.errors[1].message, 'plain failure')
  })

  it('formats expanded diagnostics without changing compact error formatting', () => {
    const cause = new Error('root failed')
    attachTrace(cause, prependTrace(stackBreadcrumb('cause trace', `Error: cause\n    at fn (${import.meta.filename}:4:5)`), undefined, { kind: 'async' }))
    const error = new Error('wrapper failed', { cause })
    Object.defineProperty(error, 'code', { value: 'TEST_WRAPPER' })

    assert.equal(formatError(error), 'Error: wrapper failed')
    assert.match(formatDiagnostic(error), /Error \[TEST_WRAPPER\]: wrapper failed/)
    assert.match(formatDiagnostic(error), /Caused by:/)
    assert.match(formatDiagnostic(error), /at cause trace \(kind=async\)/)
    assert.match(formatDiagnostic(error), new RegExp(`${escapeRegExp(import.meta.filename)}:4:5`))
  })
})

const breadcrumb = (message: string): Breadcrumb => ({ message })

const stackReadingBreadcrumb = (message: string, onRead: () => void): Breadcrumb => ({
  message,
  get stack() {
    onRead()
    return `Error: ${message}\n    at fake (${import.meta.filename}:1:1)`
  }
})

const stackBreadcrumb = (message: string, stack: string): Breadcrumb => ({
  message,
  stack
})

const messagesOf = (trace: ReturnType<typeof prependTrace>) => {
  const messages: string[] = []
  let current: typeof trace | undefined = trace
  while (current !== undefined) {
    messages.push(current.frame.message)
    current = current.parent
  }
  return messages
}

const escapeRegExp = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
