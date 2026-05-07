import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { at } from './Breadcrumb.js'
import { fail } from './Fail.js'
import { runPromise } from './Fx.js'
import { MaxTraceDepth, appendTrace, attachTrace, captureTrace, formatError, formatTrace, getTrace, getTraceCapturePolicy, prependTrace, setTraceCapturePolicy } from './Trace.js'
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

  it('detects cycles while formatting traces', () => {
    const trace = { frame: { message: 'cycle' }, depth: 1, truncated: false } as Trace & { parent?: Trace }
    trace.parent = trace

    assert.match(formatTrace(trace), /<trace cycle detected>/)
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
})

const breadcrumb = (message: string): Breadcrumb => ({ message })

const stackReadingBreadcrumb = (message: string, onRead: () => void): Breadcrumb => ({
  message,
  get stack() {
    onRead()
    return `Error: ${message}\n    at fake (${import.meta.filename}:1:1)`
  }
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
