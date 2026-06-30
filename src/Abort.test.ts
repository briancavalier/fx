import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abort, Abort, orReturn, restartOnAbort } from './Abort.js'
import { at } from './Breadcrumb.js'
import { originOf, withOrigin } from './Effect.js'
import { fail, Fail, returnFail } from './Fail.js'
import { andFinallyIn } from './Finalization.js'
import { fx, ok, run, type Fx } from './Fx.js'
import { returnFrom } from './ReturnFrom.js'
import { scope, withControlScope, withScope, type Control } from './Scope.js'

describe('Abort', () => {
  const TestScope = scope<Control>()('test/Abort')

  describe('scope', () => {
    it('handles Abort from a same-id scope token', () => {
      const FirstScope = scope<Control>()('test/Abort/same-id')
      const SecondScope = scope<Control>()('test/Abort/same-id')
      const result = fx(function* () {
        yield* abort(SecondScope)
        return 'done'
      }).pipe(withScope(FirstScope), orReturn(FirstScope, 'aborted'), run)

      assert.equal(result, 'aborted')
    })

    it('given matching Abort with fallback, returns alternative', () => {
      const r = Math.random()
      const a = abort(TestScope).pipe(withScope(TestScope), orReturn(TestScope, r), run)

      assert.equal(a, r)
    })

    it('given success, returns original value', () => {
      const r = Math.random()
      const a = ok(r).pipe(withScope(TestScope), orReturn(TestScope, r + 1), run)

      assert.equal(a, r)
    })

    it('leaves matching Abort unhandled when fallback is omitted', () => {
      const f = abort(TestScope).pipe(withScope(TestScope))
      const _: typeof f extends import('./Fx.js').Fx<Abort<typeof TestScope>, never> ? true : false = true

      assert.equal(Abort.is(f[Symbol.iterator]().next().value), true)
    })

    it('does not handle Abort from a different scope', () => {
      const OtherScope = scope<Control>()('test/Abort/other')
      const f = fx(function* () {
        yield* abort(OtherScope)
        return 'done'
      }).pipe(withScope(TestScope), orReturn(TestScope, 'aborted'))

      assert.equal(Abort.is(f[Symbol.iterator]().next().value), true)
    })
  })

  describe('restartOnAbort', () => {
    it('requires an explicit control scope handle', () => {
      const typecheck = (): void => {
        // @ts-expect-error restartOnAbort requires an explicit control scope handle.
        const invalid = restartOnAbort({ restarts: 1 })
        void invalid
      }
      void typecheck
    })

    it('restarts a scoped computation after abort and returns success', () => {
      let attempts = 0

      const result = fx(function* () {
        attempts += 1
        if (attempts < 3) yield* abort(TestScope)
        return 'ok'
      }).pipe(
        restartOnAbort(TestScope, { restarts: 2 }),
        orReturn(TestScope, 'exhausted'),
        run
      )

      assert.equal(result, 'ok')
      assert.equal(attempts, 3)
    })

    it('uses a fresh iterator for each attempt', () => {
      const attempts = [] as number[]

      const result = fx(function* () {
        attempts.push(attempts.length + 1)
        if (attempts.length < 3) yield* abort(TestScope)
        return attempts.length
      }).pipe(
        restartOnAbort(TestScope, { restarts: 2 }),
        orReturn(TestScope, 0),
        run
      )

      assert.equal(result, 3)
      assert.deepEqual(attempts, [1, 2, 3])
    })

    it('runs scoped finalizers for each aborted attempt before the next attempt', () => {
      let attempts = 0
      const released = [] as string[]

      const result = fx(function* () {
        attempts += 1
        const attempt = attempts
        yield* andFinallyIn(TestScope, fx(function* () {
          released.push(`release:${attempt}`)
        }))

        if (attempt < 3) yield* abort(TestScope)
        return 'done'
      }).pipe(
        restartOnAbort(TestScope, { restarts: 2 }),
        orReturn(TestScope, 'exhausted'),
        returnFail,
        run
      )

      assert.equal(result, 'done')
      assert.deepEqual(released, ['release:1', 'release:2', 'release:3'])
    })

    it('leaves Abort visible when restarts are exhausted', () => {
      let attempts = 0

      const result = fx(function* () {
        attempts += 1
        yield* abort(TestScope)
      }).pipe(
        restartOnAbort(TestScope, { restarts: 1 }),
        orReturn(TestScope, 'exhausted'),
        run
      )

      assert.equal(result, 'exhausted')
      assert.equal(attempts, 2)
    })

    it('preserves the final abort effect when restarts are exhausted', () => {
      const original = withOrigin(
        new Abort(TestScope, undefined),
        at('test/Abort/restartOnAbort/original')
      )

      const f = fx(function* () {
        return yield* original
      }).pipe(restartOnAbort(TestScope, { restarts: 0 }))

      const next = f[Symbol.iterator]().next()

      assert.equal(next.value, original)
      assert.equal(originOf(next.value), originOf(original))
    })

    it('includes same-scope returnFrom values in its result type', () => {
      const returned = fx(function* () {
        yield* returnFrom(TestScope, 'early')
        return 'late'
      }).pipe(restartOnAbort(TestScope, { restarts: 1 }))
      const _: typeof returned extends Fx<Abort<typeof TestScope>, 'early' | 'late'> ? true : false = true

      assert.equal(returned.pipe(orReturn(TestScope, 'aborted'), run), 'early')
    })

    it('does not restart Abort from a different scope', () => {
      const OtherScope = scope<Control>()('test/Abort/restartOnAbort/other')
      let attempts = 0

      const f = fx(function* () {
        attempts += 1
        yield* abort(OtherScope)
        return 'done'
      }).pipe(restartOnAbort(TestScope, { restarts: 2 }))

      const next = f[Symbol.iterator]().next()

      assert.equal(Abort.is(next.value), true)
      assert.equal((next.value as Abort<typeof OtherScope>).scope, OtherScope)
      assert.equal(attempts, 1)
    })

    it('stops restarting when cleanup fails after abort', () => {
      const cleanupFailure = new Error('cleanup failed')
      let attempts = 0

      const result = fx(function* () {
        attempts += 1
        yield* andFinallyIn(TestScope, fail(cleanupFailure))
        yield* abort(TestScope)
      }).pipe(
        restartOnAbort(TestScope, { restarts: 2 }),
        orReturn(TestScope, undefined),
        returnFail,
        run
      )

      assert.ok(Fail.is(result))
      assert.ok(result.arg instanceof AggregateError)
      assert.deepEqual(result.arg.errors, [cleanupFailure])
      assert.equal(attempts, 1)
    })

    it('keeps lexical control handles open across restart attempt boundaries', () => {
      let attempts = 0
      const released = [] as string[]

      const result = withControlScope({ label: 'restartable' }, controlScope => fx(function* () {
        attempts += 1
        const attempt = attempts
        yield* andFinallyIn(controlScope, fx(function* () {
          released.push(`release:${attempt}`)
        }))

        if (attempt === 1) yield* abort(controlScope)
        return 'done'
      }).pipe(
        restartOnAbort(controlScope, { restarts: 1 }),
        orReturn(controlScope, 'exhausted'),
        returnFail
      )).pipe(run)

      assert.equal(result, 'done')
      assert.equal(attempts, 2)
      assert.deepEqual(released, ['release:1', 'release:2'])
    })

    it('preserves Abort typing until a downstream handler interprets exhaustion', () => {
      const exhausted = abort(TestScope).pipe(
        restartOnAbort(TestScope, { restarts: 0 })
      )
      const _: typeof exhausted extends Fx<Abort<typeof TestScope>, never> ? true : false = true

      const handled = exhausted.pipe(orReturn(TestScope, 'exhausted'))
      const __: typeof handled extends Fx<never, 'exhausted'> ? true : false = true

      assert.equal(handled.pipe(run), 'exhausted')
    })
  })
})
