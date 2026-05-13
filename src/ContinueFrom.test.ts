import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  continueFrom,
  ContinueFrom,
  guardFrom,
  isContinuedFrom,
  orContinue,
  type ContinuedFrom
} from './ContinueFrom.js'
import { fail, returnFail } from './Fail.js'
import { fx, run, type Fx } from './Fx.js'
import { andFinally, andFinallyExit } from './Finalization.js'
import { scope, type Exit } from './Scope.js'

describe('ContinueFrom', () => {
  const TestScope = 'test/ContinueFrom' as const

  it('returns a continue marker from the matching scope', () => {
    const result = continueFrom(TestScope).pipe(
      scope(TestScope),
      orContinue(TestScope),
      run
    )

    assert.deepEqual(result, { type: 'continueFrom', scope: TestScope })
  })

  it('supports continuing an explicit JavaScript loop', () => {
    const result = fx(function* () {
      const values = [] as string[]

      for (let i = 0; i < 5; ++i) {
        const r = yield* fx(function* () {
          if (i % 2 === 0) yield* continueFrom(TestScope)
          values.push(`body:${i}`)
          return `done:${i}`
        }).pipe(scope(TestScope), orContinue(TestScope))

        if (isContinuedFrom(TestScope, r)) continue
        values.push(r)
      }

      return values
    }).pipe(run)

    assert.deepEqual(result, ['body:1', 'done:1', 'body:3', 'done:3'])
  })

  it('does not run code after continueFrom', () => {
    let ran = false

    const result = fx(function* () {
      yield* continueFrom(TestScope)
      ran = true
      return 'late'
    }).pipe(
      scope(TestScope),
      orContinue(TestScope),
      returnFail,
      run
    )

    assert.equal(isContinuedFrom(TestScope, result), true)
    assert.equal(ran, false)
  })

  it('guardFrom continues when the condition is false', () => {
    let ran = false

    const result = fx(function* () {
      yield* guardFrom(TestScope, false)
      ran = true
    }).pipe(
      scope(TestScope),
      orContinue(TestScope),
      run
    )

    assert.equal(isContinuedFrom(TestScope, result), true)
    assert.equal(ran, false)
  })

  it('guardFrom does not continue when the condition is true', () => {
    let ran = false

    const result = fx(function* () {
      yield* guardFrom(TestScope, true)
      ran = true
      return 'done'
    }).pipe(
      scope(TestScope),
      orContinue(TestScope),
      run
    )

    assert.equal(result, 'done')
    assert.equal(ran, true)
  })

  it('propagates continueFrom for non-matching scopes', () => {
    const OtherScope = 'test/ContinueFrom/other' as const
    const f = fx(function* () {
      yield* continueFrom(OtherScope)
      return 'late'
    }).pipe(
      scope(TestScope),
      orContinue(TestScope)
    )

    const _: typeof f extends Fx<ContinueFrom<typeof OtherScope>, string | ContinuedFrom<typeof TestScope>> ? true : false = true
    const next = f[Symbol.iterator]().next()

    assert.equal(ContinueFrom.is(next.value), true)
  })

  it('narrows matching ContinueFrom effects', () => {
    const f = continueFrom(TestScope).pipe(
      scope(TestScope),
      orContinue(TestScope)
    )

    const _: typeof f extends Fx<never, ContinuedFrom<typeof TestScope>> ? true : false = true

    assert.equal(isContinuedFrom(TestScope, f.pipe(run)), true)
  })

  it('runs scoped finalizers after handled continueFrom', () => {
    const released = [] as string[]

    const result = fx(function* () {
      yield* andFinally(TestScope, record(released, 'A'))
      yield* andFinally(TestScope, record(released, 'B'))
      yield* continueFrom(TestScope)
    }).pipe(
      scope(TestScope),
      orContinue(TestScope),
      returnFail,
      run
    )

    assert.equal(isContinuedFrom(TestScope, result), true)
    assert.deepEqual(released, ['B', 'A'])
  })

  it('provides continueFrom exit to exit-aware finalizers before handling', () => {
    const exits = [] as Exit[]

    const result = fx(function* () {
      yield* andFinallyExit(TestScope, exit => fx(function* () {
        exits.push(exit)
      }))
      yield* continueFrom(TestScope)
    }).pipe(
      scope(TestScope),
      orContinue(TestScope),
      returnFail,
      run
    )

    assert.equal(isContinuedFrom(TestScope, result), true)
    assert.deepEqual(exits, [{ type: 'continueFrom', scope: TestScope }])
  })
})

const record = (released: string[], label: string, failure?: unknown) => fx(function* () {
  released.push(label)
  if (failure !== undefined) yield* fail(failure)
})
