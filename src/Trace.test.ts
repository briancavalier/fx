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

  it('formats aggregate errors with compact indexed child summaries', () => {
    const child = new Error('wrapped child', { cause: new TypeError('root child') })
    const aggregate = new AggregateError([child, 'plain failure'], 'aggregate failed')

    assert.equal(formatError(aggregate), [
      'AggregateError: aggregate failed',
      '  [0] TypeError: root child',
      '  [1] plain failure'
    ].join('\n'))
  })

  it('formats RaceAllFailed with compact child failure summaries', () => {
    const first = new Error('Unhandled failure in forked task', { cause: new Error('primary failed') })
    const second = new Error('Unhandled failure in forked task', { cause: new Error('replica failed') })
    const aggregate = raceAllFailed([first, second])

    assert.equal(formatError(aggregate), [
      'RaceAllFailed: All raced computations failed',
      '  [0] Error: primary failed',
      '  [1] Error: replica failed'
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
    assert.match(formatDiagnostic(error), /Fx trace:/)
    assert.match(formatDiagnostic(error), /Caused by:/)
    assert.match(formatDiagnostic(error), /at cause trace \[async\]/)
    assert.match(formatDiagnostic(error), new RegExp(`${escapeRegExp(import.meta.filename)}:4:5`))
  })

  it('formats diagnostics without ansi escapes when colors are disabled', () => {
    const error = tracedError('plain', 'plain trace', { kind: 'fail' })
    Object.defineProperty(error, 'code', { value: 'TEST_PLAIN' })

    const formatted = formatDiagnostic(error, { colors: 'never' })

    assert.doesNotMatch(formatted, ansiPattern)
    assert.match(formatted, /Error \[TEST_PLAIN\]: plain/)
  })

  it('formats diagnostics with ansi escapes when colors are forced', () => {
    const error = tracedError('colored', 'colored trace', { kind: 'timeout' })
    Object.defineProperty(error, 'code', { value: 'TEST_COLOR' })

    const formatted = formatDiagnostic(error, { colors: 'always' })

    assert.match(formatted, ansiPattern)
    assert.match(stripAnsi(formatted), /Error \[TEST_COLOR\]: colored/)
    assert.match(stripAnsi(formatted), /at colored trace \[timeout\]/)
    assert.match(stripAnsi(formatted), new RegExp(`${escapeRegExp(import.meta.filename)}:10:11`))
  })

  it('formats diagnostics without ansi escapes by default in non-tty test runs', () => {
    const previousNoColor = process.env.NO_COLOR
    process.env.NO_COLOR = '1'
    try {
      const formatted = formatDiagnostic(tracedError('default plain', 'default trace'))

      assert.doesNotMatch(formatted, ansiPattern)
    } finally {
      restoreEnv('NO_COLOR', previousNoColor)
    }
  })

  it('formats indexed race metadata as a child label', () => {
    const error = tracedError('race failed', 'race trace', { kind: 'race', index: 1 })

    assert.match(formatDiagnostic(error, { colors: 'never' }), /at race trace \[race child #1\]/)
  })

  it('formats source snippets with default one-line context', () => {
    const error = tracedErrorAt('source failed', 'source trace', 10, 11, { kind: 'fail' })
    const formatted = formatDiagnostic(error, {
      colors: 'never',
      source: { lookup: () => sourceFixture }
    })

    assert.match(formatted, /9 \| const previous = value/)
    assert.match(formatted, /10 \| yield\* fail\(new Error\('boom'\)\)/)
    assert.match(formatted, /\| {11}\^/)
    assert.match(formatted, /11 \| return previous/)
  })

  it('formats source snippets with zero context lines', () => {
    const error = tracedErrorAt('source failed', 'source trace', 10, 11, { kind: 'fail' })
    const formatted = formatDiagnostic(error, {
      colors: 'never',
      source: { lookup: () => sourceFixture, contextLines: 0 }
    })

    assert.doesNotMatch(formatted, /9 \| const previous = value/)
    assert.match(formatted, /10 \| yield\* fail\(new Error\('boom'\)\)/)
    assert.doesNotMatch(formatted, /11 \| return previous/)
  })

  it('falls back when source lookup is missing or throws', () => {
    const error = tracedErrorAt('source failed', 'source trace', 10, 11, { kind: 'fail' })

    assert.doesNotThrow(() => formatDiagnostic(error, {
      colors: 'never',
      source: { lookup: () => { throw new Error('lookup failed') } }
    }))
    assert.doesNotMatch(formatDiagnostic(error, {
      colors: 'never',
      source: { lookup: () => undefined }
    }), /10 \|/)
  })

  it('formats one source snippet per aggregate child unique trace prefix', () => {
    const first = tracedErrorAt('primary failed', 'fx/Fail/fail', 10, 11, { kind: 'fail' }, sharedRaceTrace(0))
    const second = tracedErrorAt('replica failed', 'fx/Fail/fail', 10, 11, { kind: 'fail' }, sharedRaceTrace(1))
    const aggregate = raceAllFailed([first, second])
    const formatted = formatDiagnostic(aggregate, {
      colors: 'never',
      source: { lookup: () => sourceFixture }
    })

    assert.equal(countOccurrences(formatted, "10 | yield* fail(new Error('boom'))"), 2)
    assert.match(formatted, /Shared parent trace:/)
    assert.doesNotMatch(formatted, /19 \|/)
  })

  it('colors source snippet gutter and caret when colors are forced', () => {
    const error = tracedErrorAt('source failed', 'source trace', 10, 11, { kind: 'fail' })
    const formatted = formatDiagnostic(error, {
      colors: 'always',
      source: { lookup: () => sourceFixture }
    })

    assert.match(formatted, ansiPattern)
    assert.match(stripAnsi(formatted), /10 \| yield\* fail\(new Error\('boom'\)\)/)
    assert.match(stripAnsi(formatted), /\| {11}\^/)
    const esc = String.fromCharCode(27)

    assert.ok(formatted.includes(`${esc}[2m 9 |${esc}[0m ${esc}[2mconst previous = value${esc}[0m`))
    assert.ok(formatted.includes(`${esc}[2m10 |${esc}[0m ${esc}[2myield* fai${esc}[0ml(new Error('boom'))`))
    assert.ok(formatted.includes(`${esc}[2m11 |${esc}[0m ${esc}[2mreturn previous${esc}[0m`))
  })

  it('compacts cause traces already shown by the parent trace', () => {
    const cause = tracedError('child failed', 'shared child trace', { kind: 'fail' })
    const parent = new Error('wrapper failed', { cause })
    attachTrace(parent, appendTrace(getTrace(cause) as ReturnType<typeof prependTrace>, prependTrace(breadcrumb('parent trace'))))

    const formatted = formatDiagnostic(parent, { colors: 'never' })

    assert.equal(countOccurrences(formatted, 'Fx trace:'), 1)
    assert.match(formatted, /<trace already shown above>/)
    assert.match(formatted, /Caused by:\n  Error: child failed/)
  })

  it('compacts nested fork-style wrapper traces without duplicating source snippets', () => {
    const root = new Error('root failed')
    const inner = new Error('Unhandled failure in forked task', { cause: root })
    Object.defineProperty(inner, 'code', { value: 'FX_UNHANDLED_FAILURE' })
    attachTrace(inner, prependTrace(
      stackBreadcrumb('fx/Fail/fail', `Error: fail\n    at fail (${import.meta.filename}:10:11)`),
      prependTrace(stackBreadcrumb('fx/Concurrent/fork', `Error: fork\n    at fork (${import.meta.filename}:20:21)`), undefined, { kind: 'fork' }),
      { kind: 'fail' }
    ))

    const outer = new Error('Unhandled failure in forked task', { cause: inner })
    Object.defineProperty(outer, 'code', { value: 'FX_UNHANDLED_FAILURE' })
    attachTrace(outer, prependTrace(
      stackBreadcrumb('fx/Fail/fail', `Error: fail\n    at fail (${import.meta.filename}:10:11)`),
      prependTrace(
        stackBreadcrumb('fx/Concurrent/fork', `Error: fork\n    at fork (${import.meta.filename}:20:21)`),
        prependTrace(stackBreadcrumb('fx/Concurrent/fork', `Error: fork\n    at fork (${import.meta.filename}:30:31)`), undefined, { kind: 'fork' }),
        { kind: 'fork' }
      ),
      { kind: 'fail' }
    ))

    const formatted = formatDiagnostic(outer, {
      colors: 'never',
      source: { lookup: () => sourceFixture }
    })

    assert.equal(countOccurrences(formatted, 'Error [FX_UNHANDLED_FAILURE]: Unhandled failure in forked task'), 2)
    assert.equal(countOccurrences(formatted, '<trace already shown above>'), 1)
    assert.equal(countOccurrences(formatted, "10 | yield* fail(new Error('boom'))"), 1)
    assert.match(formatted, /Caused by:\n    Error: root failed/)
  })

  it('does not compact cause traces not shown by the parent trace', () => {
    const cause = tracedError('child failed', 'child trace', { kind: 'fail' })
    const parent = tracedError('wrapper failed', 'parent trace', { kind: 'fork' })
    Object.defineProperty(parent, 'cause', { value: cause })

    const formatted = formatDiagnostic(parent, { colors: 'never' })

    assert.equal(countOccurrences(formatted, 'Fx trace:'), 2)
    assert.doesNotMatch(formatted, /<trace already shown above>/)
    assert.match(formatted, /at child trace \[fail\]/)
  })

  it('colors compacted cause trace notes when colors are forced', () => {
    const cause = tracedError('child failed', 'shared child trace', { kind: 'fail' })
    const parent = new Error('wrapper failed', { cause })
    attachTrace(parent, appendTrace(getTrace(cause) as ReturnType<typeof prependTrace>, prependTrace(breadcrumb('parent trace'))))

    const formatted = formatDiagnostic(parent, { colors: 'always' })

    assert.match(formatted, ansiPattern)
    assert.match(stripAnsi(formatted), /<trace already shown above>/)
  })

  it('formats RaceAllFailed aggregates as failed race children with shared parent trace', () => {
    const first = tracedError('primary failed', 'fx/Fail/fail', { kind: 'fail' }, sharedRaceTrace(0))
    const second = tracedError('replica failed', 'fx/Fail/fail', { kind: 'fail' }, sharedRaceTrace(1))
    const aggregate = raceAllFailed([first, second])

    const formatted = formatDiagnostic(aggregate, { colors: 'never' })

    assert.match(formatted, /RaceAllFailed \[FX_RACE_ALL_FAILED\]: All raced computations failed/)
    assert.match(formatted, /Failed race children:/)
    assert.match(formatted, /\n  \[0\]\n/)
    assert.match(formatted, /\n  \[1\]\n/)
    assert.match(formatted, /at fx\/Concurrent\/race\[1\] \[race child #1\]/)
    assert.match(formatted, /Shared parent trace:/)
    assert.equal(countOccurrences(formatted, 'at fx/Concurrent/race [race]'), 1)
  })

  it('formats generic aggregates as aggregate errors', () => {
    const first = tracedError('child failed', 'child trace', { kind: 'fail' })
    const aggregate = new AggregateError([first, 'plain failure'], 'aggregate failed')

    const formatted = formatDiagnostic(aggregate, { colors: 'never' })

    assert.match(formatted, /AggregateError: aggregate failed/)
    assert.match(formatted, /Aggregate errors:/)
    assert.match(formatted, /\n  \[0\]\n/)
    assert.match(formatted, /\n  \[1\]\n/)
    assert.match(formatted, /string: plain failure/)
  })

  it('does not deduplicate aggregate traces without a common trailing parent frame', () => {
    const first = tracedError('first failed', 'first child', { kind: 'fail' }, prependTrace(breadcrumb('first parent'), undefined, { kind: 'fork' }))
    const second = tracedError('second failed', 'second child', { kind: 'fail' }, prependTrace(breadcrumb('second parent'), undefined, { kind: 'fork' }))
    const aggregate = new AggregateError([first, second], 'aggregate failed')

    const formatted = formatDiagnostic(aggregate, { colors: 'never' })

    assert.doesNotMatch(formatted, /Shared parent trace:/)
    assert.match(formatted, /at first parent \[fork\]/)
    assert.match(formatted, /at second parent \[fork\]/)
  })

  it('keeps compact error and trace formatting unchanged', () => {
    const trace = prependTrace(breadcrumb('frame'))
    const cause = new Error('root failed')
    const error = new Error('wrapper failed', { cause })
    attachTrace(error, trace)

    assert.equal(formatError(error), [
      'Error: root failed',
      '  at frame'
    ].join('\n'))
    assert.equal(formatTrace(trace), '  at frame')
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

const tracedError = (
  message: string,
  traceMessage: string,
  metadata = {},
  parent?: ReturnType<typeof prependTrace>
) => {
  return tracedErrorAt(message, traceMessage, 10, 11, metadata, parent)
}

const tracedErrorAt = (
  message: string,
  traceMessage: string,
  line: number,
  column: number,
  metadata = {},
  parent?: ReturnType<typeof prependTrace>
) => {
  const error = new Error(message)
  attachTrace(error, prependTrace(
    stackBreadcrumb(traceMessage, `Error: ${traceMessage}\n    at fn (${import.meta.filename}:${line}:${column})`),
    parent,
    metadata
  ))
  return error
}

const sharedRaceTrace = (index: number) =>
  prependTrace(
    stackBreadcrumb(`fx/Concurrent/race[${index}]`, `Error: race child\n    at child (${import.meta.filename}:20:21)`),
    prependTrace(
      stackBreadcrumb('fx/Concurrent/race', `Error: race\n    at race (${import.meta.filename}:19:20)`),
      undefined,
      { kind: 'race' }
    ),
    { kind: 'race', index }
  )

const raceAllFailed = (errors: readonly unknown[]) => {
  const error = new Error('All raced computations failed')
  Object.defineProperty(error, 'name', { value: 'RaceAllFailed' })
  Object.defineProperty(error, 'code', { value: 'FX_RACE_ALL_FAILED' })
  Object.defineProperty(error, 'errors', { value: errors })
  return error
}

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

const ansiPattern = ansiRegex()

const stripAnsi = (s: string) =>
  s.replaceAll(ansiRegex('g'), '')

const countOccurrences = (s: string, pattern: string) =>
  s.split(pattern).length - 1

const restoreEnv = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const sourceFixture = [
  'const one = 1',
  'const two = 2',
  'const three = 3',
  'const four = 4',
  'const five = 5',
  'const six = 6',
  'const seven = 7',
  'const value = one + two',
  'const previous = value',
  "yield* fail(new Error('boom'))",
  'return previous',
  'const done = true'
].join('\n')

function ansiRegex(flags?: string): RegExp {
  return new RegExp(`${escapeRegExp(String.fromCharCode(27))}\\[[0-9;]+m`, flags)
}
