import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { at } from './Breadcrumb.js'
import { Effect, EffectOriginTypeId, originOf, ScopedEffect, traceOriginOf, withOrigin, withTraceOrigin } from './Effect.js'
import { scope } from './Scope.js'
import { captureTrace, setTraceCapturePolicy } from './Trace.js'

describe('Effect', () => {
  describe('of', () => {
    it('constructs an instance of the effect class', () => {
      class T extends Effect('T/of')<[string], number> { }
      const effect = T.of('test')

      assert.ok(effect instanceof T)
      assert.ok(T.is(effect))
      assert.equal(effect.arg, 'test')
    })

    it('supports void-argument effects without an argument', () => {
      class T extends Effect('T/of/void')<[], string> { }
      const effect = T.of()
      const arg: void = effect.arg

      // @ts-expect-error Zero-argument effects do not accept an undefined payload.
      T.of(undefined)

      assert.ok(effect instanceof T)
      assert.equal(arg, undefined)
      assert.equal(effect.arg, undefined)
    })

    it('supports multi-argument effects', () => {
      class T extends Effect('T/of/multi')<[string, number], boolean> { }
      const effect = T.of('test', 1)
      const arg: readonly [string, number] = effect.arg

      // @ts-expect-error Multi-argument effects require all arguments.
      T.of('test')

      assert.ok(effect instanceof T)
      assert.deepEqual(effect.arg, ['test', 1])
      void arg
    })
  })

  describe('is', () => {
    it('given instance of the same effect, returns true', () => {
      class T extends Effect('T')<[], void> { }
      assert.ok(T.is(new T()))
    })

    it('given instace of a different effect, returns false', () => {
      class T extends Effect('T')<[], void> { }
      class U extends Effect('U')<[], void> { }
      assert.ok(!T.is(new U()))
      assert.ok(!U.is(new T()))
    })
  })

  describe('ScopedEffect', () => {
    it('uses a top-level scope field', () => {
      const TestScope = scope('test/scope')
      class T extends ScopedEffect('T/Scoped')<typeof TestScope, [{ readonly value: number }], string> { }
      const effect = new T(TestScope, { value: 1 })

      assert.ok(T.is(effect))
      assert.equal(effect.scope, TestScope)
      assert.deepEqual(effect.arg, { value: 1 })
    })

    it('yields and resumes like an ordinary effect', () => {
      const TestScope = scope('test/scope')
      class T extends ScopedEffect('T/ScopedIterator')<typeof TestScope, [], string> { }
      const effect = new T(TestScope)
      const iterator = effect[Symbol.iterator]()

      const yielded = iterator.next()
      assert.equal(yielded.done, false)
      assert.equal(yielded.value, effect)

      const done = iterator.next('done')
      assert.equal(done.done, true)
      assert.equal(done.value, 'done')
    })

    it('supports multi-argument scoped effects', () => {
      const TestScope = scope('test/scope')
      class T extends ScopedEffect('T/ScopedMulti')<typeof TestScope, [string, number], boolean> { }
      const effect = T.of(TestScope, 'test', 1)
      const arg: readonly [string, number] = effect.arg

      // @ts-expect-error Scoped multi-argument effects require all operation arguments.
      T.of(TestScope, 'test')

      assert.ok(T.is(effect))
      assert.equal(effect.scope, TestScope)
      assert.deepEqual(effect.arg, ['test', 1])
      void arg
    })
  })

  describe('withOrigin', () => {
    it('attaches a non-enumerable diagnostic trace origin', () => {
      class T extends Effect('T')<[], void> { }
      const origin = at('test/origin')
      const effect = withOrigin(new T(), origin)
      const traceOrigin = traceOriginOf(effect)

      assert.equal(originOf(effect), origin)
      assert.equal(traceOrigin?.origin, origin)
      assert.equal(traceOrigin?.trace?.frame.message, 'test/origin')
      assert.equal(Object.getOwnPropertyDescriptor(effect, EffectOriginTypeId)?.enumerable, false)
    })

    it('preserves an explicit trace origin', () => {
      class T extends Effect('T')<[], void> { }
      const origin = at('test/explicit-origin')
      const traceOrigin = { origin, trace: undefined }
      const effect = withTraceOrigin(new T(), traceOrigin)

      assert.equal(traceOriginOf(effect), traceOrigin)
    })

    it('accepts an explicit trace', () => {
      class T extends Effect('T')<[], void> { }
      const origin = at('test/explicit-trace-origin')
      const trace = captureTrace(origin)
      const effect = withOrigin(new T(), origin, trace)

      assert.equal(traceOriginOf(effect)?.origin, origin)
      assert.equal(traceOriginOf(effect)?.trace, trace)
    })

    it('respects trace capture policy', () => {
      class T extends Effect('T')<[], void> { }
      const previous = setTraceCapturePolicy('off')
      try {
        const effect = withOrigin(new T(), at('test/off-origin'))

        assert.equal(traceOriginOf(effect)?.trace, undefined)
      } finally {
        setTraceCapturePolicy(previous)
      }
    })

    it('given an untagged value, originOf returns undefined', () => {
      assert.equal(originOf({}), undefined)
      assert.equal(traceOriginOf({}), undefined)
      assert.equal(originOf(null), undefined)
      assert.equal(traceOriginOf(null), undefined)
    })
  })
})
