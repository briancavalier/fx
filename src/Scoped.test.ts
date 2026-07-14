import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { abort, orReturn } from './Abort.js'
import { forkIn, withUnboundedConcurrency } from './Concurrent.js'
import { assert as assertNoFail, Fail, returnFail } from './Fail.js'
import { andFinallyIn, type Finally } from './Finalization.js'
import { fx, ok, run, runPromise, type Fx } from './Fx.js'
import { key } from './Key.js'
import { returnFrom, ReturnFrom } from './ReturnFrom.js'
import { scoped } from './Scoped.js'
import { inScope, sameScope, scope, withControlScope, withScope, type AnyControlScope, type AnyLifetimeScope, type Control } from './Scope.js'
import { modifyState, type ModifyState, type Stateful } from './State.js'

describe('lexical scope handles', () => {
  it('creates distinct lexical handles for scopes with the same label', () => {
    let first: AnyLifetimeScope | undefined
    let second: AnyLifetimeScope | undefined

    const result = withScope({ label: 'request' }, outer => fx(function* () {
      first = outer
      return yield* withScope({ label: 'request' }, inner => fx(function* () {
        second = inner
        return sameScope(outer, inner)
      }))
    })).pipe(run)

    assert.equal(result, false)
    assert.equal(first?.label, 'request')
    assert.equal(second?.label, 'request')
  })

  it('rejects scope handles used after their lexical scope exits', () => {
    let leaked: AnyLifetimeScope | undefined

    withScope(scope => fx(function* () {
      leaked = scope
    })).pipe(run)

    assert.throws(
      () => andFinallyIn(leaked!, ok(undefined)),
      /used after its scope exited/
    )
  })

  it('rejects closed lexical handles passed to explicit inScope', () => {
    let leaked: AnyLifetimeScope | undefined

    withScope(scope => fx(function* () {
      leaked = scope
    })).pipe(run)

    assert.throws(
      () => inScope(leaked!),
      /used after its scope exited/
    )
  })

  it('rejects cached inScope pipeables for closed lexical handles', () => {
    let cached: ((f: Fx<unknown, unknown>) => Fx<unknown, unknown>) | undefined

    withScope(scope => fx(function* () {
      cached = inScope(scope)
    })).pipe(run)

    assert.throws(
      () => cached!(andFinallyIn(scope('test/unused'), ok(undefined))),
      /used after its scope exited/
    )
  })

  it('rejects escaped scope boundaries for closed lexical handles', () => {
    let escaped: Fx<unknown, unknown> | undefined

    withScope(scope => fx(function* () {
      escaped = andFinallyIn(scope, ok(undefined)).pipe(inScope(scope))
    })).pipe(run)

    assert.throws(
      () => escaped![Symbol.iterator]().next(),
      /used after its scope exited/
    )
  })

  it('closes lexical lifetime handles when body construction throws', () => {
    let leaked: AnyLifetimeScope | undefined

    assert.throws(
      () => withScope(scope => {
        leaked = scope
        throw new Error('construction failed')
      })[Symbol.iterator]().next(),
      /construction failed/
    )

    assert.throws(
      () => andFinallyIn(leaked!, ok(undefined)),
      /used after its scope exited/
    )
  })

  it('closes lexical control handles when body construction throws', () => {
    let leaked: AnyControlScope | undefined

    assert.throws(
      () => withControlScope(scope => {
        leaked = scope
        throw new Error('construction failed')
      })[Symbol.iterator]().next(),
      /construction failed/
    )

    assert.throws(
      () => abort(leaked!),
      /used after its scope exited/
    )
  })

  it('allocates lexical lifetime handles per execution', () => {
    const handles: AnyLifetimeScope[] = []
    const program = withScope({ label: 'repeatable' }, scope => inScope(scope, fx(function* () {
      handles.push(scope)
      yield* andFinallyIn(scope, ok(undefined))
      return 'ok' as const
    }))).pipe(returnFail)

    assert.equal(run(program), 'ok')
    assert.equal(run(program), 'ok')
    assert.equal(handles.length, 2)
    assert.equal(handles[0]?.label, 'repeatable')
    assert.equal(handles[1]?.label, 'repeatable')
    assert.equal(sameScope(handles[0]!, handles[1]!), false)
  })

  it('allocates lexical control handles per execution', () => {
    const handles: AnyControlScope[] = []
    const program = withControlScope({ label: 'repeatable control' }, scope => inScope(scope, fx(function* () {
      handles.push(scope)
      yield* abort(scope)
      return 'late' as const
    }).pipe(orReturn(scope, 'aborted' as const), returnFail)))

    assert.equal(run(program), 'aborted')
    assert.equal(run(program), 'aborted')
    assert.equal(handles.length, 2)
    assert.equal(handles[0]?.label, 'repeatable control')
    assert.equal(handles[1]?.label, 'repeatable control')
    assert.equal(sameScope(handles[0]!, handles[1]!), false)
  })

  it('does not type callback scopes as handling effects for outer lifetime handles', () => {
    const OwnerScope = scope('test/Scope/owner')
    const program = withScope(_ => forkIn(OwnerScope, ok('child')))

    // @ts-expect-error The fresh lexical scope does not own OwnerScope effects.
    const runnable: Fx<never, unknown> = program
    void runnable
  })

  it('does not type callback control scopes as handling effects for outer control handles', () => {
    const OwnerScope = scope<Control>()('test/Scope/control-owner')
    const program = withControlScope(_ => abort(OwnerScope))

    // @ts-expect-error The fresh lexical scope does not handle OwnerScope aborts.
    const runnable: Fx<never, unknown> = program
    void runnable
  })

  it('requires inScope to handle effects targeting the fresh scope', () => {
    // @ts-expect-error The fresh lexical scope's finalizer is not handled by allocation alone.
    withScope(scope => andFinallyIn(scope, ok(undefined)))
  })

  it('keeps explicit scope handles distinct at inner boundaries', () => {
    const CounterState = key<Stateful<number>>()('test/Scope/nested-counter')
    const Outer = scope('test/Scope/nested-outer')
    const Inner = scope('test/Scope/nested-inner')

    const program = inScope(Inner, andFinallyIn(Outer, modifyState(CounterState, count => [count + 1, undefined])))

    // @ts-expect-error The inner boundary does not handle the outer finalizer.
    const runnable: Fx<never, void> = program
    void runnable

    type Effects = typeof program extends Fx<infer E, void> ? E : never
    const finalizerRemains: Extract<Effects, Finally<typeof Outer, ModifyState<typeof CounterState>>> extends never ? false : true = true
    assert.equal(finalizerRemains, true)
  })

  it('eliminates effects for the explicit scope boundary', () => {
    const TestScope = scope('test/Scope/type')
    const program = andFinallyIn(TestScope, ok(undefined)).pipe(inScope(TestScope))

    const _: typeof program extends Fx<Fail<AggregateError>, void> ? true : false = true

    assert.equal(run(program.pipe(returnFail)) instanceof Fail, false)
  })
})

describe('scoped', () => {
  it('runs direct Fx programs in a private lifetime boundary', () => {
    const result = run(scoped(ok('done' as const)))

    assert.equal(result, 'done')
  })

  it('leaves caller-owned scoped effects visible', () => {
    const Outer = scope<Control>()('test/Scoped/outer')

    const program = scoped(fx(function* () {
      return yield* returnFrom(Outer, 'outer' as const)
    }))

    const _: typeof program extends Fx<ReturnFrom<typeof Outer, 'outer'>, never> ? true : false = true
    const next = program[Symbol.iterator]().next()

    assert.equal(next.done, false)
    assert.equal(ReturnFrom.is(next.value), true)
    assert.equal(next.value.scope, Outer)
  })

  it('does not expose a private handle for scoped operations', async () => {
    const events: string[] = []
    const Parent = scope('test/Scoped/parent')

    const result = await scoped(fx(function* () {
      yield* forkIn(Parent, fx(function* () {
        events.push('child')
      }))
      return 'parent' as const
    })).pipe(
      inScope(Parent),
      withUnboundedConcurrency,
      assertNoFail,
      runPromise
    )

    assert.equal(result, 'parent')
    assert.deepEqual(events, ['child'])
  })
})
