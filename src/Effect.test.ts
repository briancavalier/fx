import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { at } from './Breadcrumb.js'
import { Effect, EffectOriginTypeId, originOf, traceOriginOf, withOrigin, withTraceOrigin } from './Effect.js'
import { captureTrace, setTraceCapturePolicy } from './Trace.js'

describe('Effect', () => {
  describe('is', () => {
    it('given instance of the same effect, returns true', () => {
      class T extends Effect('T')<void, void> { }
      assert.ok(T.is(new T()))
    })

    it('given instace of a different effect, returns false', () => {
      class T extends Effect('T')<void, void> { }
      class U extends Effect('U')<void, void> { }
      assert.ok(!T.is(new U()))
      assert.ok(!U.is(new T()))
    })
  })

  describe('withOrigin', () => {
    it('attaches a non-enumerable diagnostic trace origin', () => {
      class T extends Effect('T')<void, void> { }
      const origin = at('test/origin')
      const effect = withOrigin(new T(), origin)
      const traceOrigin = traceOriginOf(effect)

      assert.equal(originOf(effect), origin)
      assert.equal(traceOrigin?.origin, origin)
      assert.equal(traceOrigin?.trace?.frame.message, 'test/origin')
      assert.equal(Object.getOwnPropertyDescriptor(effect, EffectOriginTypeId)?.enumerable, false)
    })

    it('preserves an explicit trace origin', () => {
      class T extends Effect('T')<void, void> { }
      const origin = at('test/explicit-origin')
      const traceOrigin = { origin, trace: undefined }
      const effect = withTraceOrigin(new T(), traceOrigin)

      assert.equal(traceOriginOf(effect), traceOrigin)
    })

    it('accepts an explicit trace', () => {
      class T extends Effect('T')<void, void> { }
      const origin = at('test/explicit-trace-origin')
      const trace = captureTrace(origin)
      const effect = withOrigin(new T(), origin, trace)

      assert.equal(traceOriginOf(effect)?.origin, origin)
      assert.equal(traceOriginOf(effect)?.trace, trace)
    })

    it('respects trace capture policy', () => {
      class T extends Effect('T')<void, void> { }
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
