import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect, finalizing, fx, runCatchScoped, ScopedEffect, type Fx } from '@briancavalier/fx'
import * as concurrentApi from '@briancavalier/fx/concurrent'
import * as scopeApi from '@briancavalier/fx/scope'
import * as stateApi from '@briancavalier/fx/state'
import * as timeoutApi from '@briancavalier/fx/timeout'
import {
  RaceAllFailed,
  all,
  firstSuccess,
  fork,
  forkEach,
  forkIn,
  mapAll,
  race,
  withBoundedConcurrency,
  withCoopConcurrency,
  withUnboundedConcurrency
} from '@briancavalier/fx/concurrent'
import { andFinally, andFinallyIn, sameScope, scope, scopeId, scopeLabel, using, usingIn, usingManaged, usingManagedIn, withScope, type AnyScope } from '@briancavalier/fx/scope'
import { getState, modifyState, withCheckpointedState, withCheckpointedStateInit } from '@briancavalier/fx/state'
import { TimeoutInterrupt, timeout, timeoutIn } from '@briancavalier/fx/timeout'

type EffectOf<T> = T extends Fx<infer E, unknown> ? E : never
type IsAny<T> = 0 extends 1 & T ? true : false
type HasExport<Module, Name extends PropertyKey> = Name extends keyof Module ? true : false

describe('package import inference', () => {
  it('exposes the intended curated concurrency, scope, and timeout names', () => {
    assert.equal(typeof fork, 'function')
    assert.equal(typeof forkEach, 'function')
    assert.equal(typeof forkIn, 'function')
    assert.equal(typeof all, 'function')
    assert.equal(typeof mapAll, 'function')
    assert.equal(typeof race, 'function')
    assert.equal(typeof firstSuccess, 'function')
    assert.equal(typeof withBoundedConcurrency, 'function')
    assert.equal(typeof withUnboundedConcurrency, 'function')
    assert.equal(typeof withCoopConcurrency, 'function')
    assert.equal(typeof RaceAllFailed, 'function')

    assert.equal(typeof scope, 'function')
    assert.equal(typeof scopeId, 'function')
    assert.equal(typeof scopeLabel, 'function')
    assert.equal(typeof sameScope, 'function')
    assert.equal(typeof withScope, 'function')
    assert.equal(typeof andFinally, 'function')
    assert.equal(typeof andFinallyIn, 'function')
    assert.equal(typeof using, 'function')
    assert.equal(typeof usingIn, 'function')
    assert.equal(typeof usingManaged, 'function')
    assert.equal(typeof usingManagedIn, 'function')
    assert.equal(typeof finalizing, 'function')
    assert.equal(typeof runCatchScoped, 'function')

    assert.equal(typeof getState, 'function')
    assert.equal(typeof modifyState, 'function')
    assert.equal(typeof withCheckpointedState, 'function')
    assert.equal(typeof withCheckpointedStateInit, 'function')

    assert.equal(typeof timeout, 'function')
    assert.equal(typeof timeoutIn, 'function')
    assert.equal(typeof TimeoutInterrupt, 'function')

    const noConcurrentEffect: HasExport<typeof concurrentApi, `Con${'currently'}`> = false
    const noConcurrentConstructor: HasExport<typeof concurrentApi, `con${'currently'}`> = false
    const noFirstSettled: HasExport<typeof concurrentApi, `first${'Settled'}`> = false
    const noAllPolicy: HasExport<typeof concurrentApi, `all${'Policy'}`> = false
    const noFirstSettledPolicy: HasExport<typeof concurrentApi, `first${'Settled'}Policy`> = false
    const noFirstSuccessPolicy: HasExport<typeof concurrentApi, `first${'Success'}Policy`> = false
    const noScopeTypeId: HasExport<typeof scopeApi, `Scope${'Type'}Id`> = false
    const noScopeFinalizing: HasExport<typeof scopeApi, `final${'izing'}`> = false
    const noCheckpointRequest: HasExport<typeof stateApi, `Check${'point'}`> = false
    const noCheckpointConstructor: HasExport<typeof stateApi, `check${'point'}`> = false
    const noTimeoutInScope: HasExport<typeof timeoutApi, `timeout${'In'}Scope`> = false
    assert.equal(noConcurrentEffect, false)
    assert.equal(noConcurrentConstructor, false)
    assert.equal(noFirstSettled, false)
    assert.equal(noAllPolicy, false)
    assert.equal(noFirstSettledPolicy, false)
    assert.equal(noFirstSuccessPolicy, false)
    assert.equal(noScopeTypeId, false)
    assert.equal(noScopeFinalizing, false)
    assert.equal(noCheckpointRequest, false)
    assert.equal(noCheckpointConstructor, false)
    assert.equal(noTimeoutInScope, false)
  })

  it('preserves Effect instance types through package declarations', () => {
    class AskName extends Effect('test/package-import-inference/AskName')<string, string> { }

    const program = fx(function* () {
      return yield* new AskName('name')
    })

    const effectIsAny: IsAny<EffectOf<typeof program>> = false
    const effectIsAskName: EffectOf<typeof program> extends AskName ? true : false = true

    // @ts-expect-error AskName remains visible until a handler removes it.
    const runnable: Fx<never, string> = program

    assert.equal(effectIsAny, false)
    assert.equal(effectIsAskName, true)
    void runnable
  })

  it('preserves ScopedEffect instance types through package declarations', () => {
    const Scope = scope('test/package-import-inference/ScopedAsk')
    class ScopedAsk<const S extends AnyScope> extends ScopedEffect('test/package-import-inference/ScopedAsk')<S, string, string> { }

    const program = fx(function* () {
      return yield* new ScopedAsk(Scope, 'name')
    })

    const effectIsAny: IsAny<EffectOf<typeof program>> = false
    const effectIsScopedAsk: EffectOf<typeof program> extends ScopedAsk<typeof Scope> ? true : false = true

    // @ts-expect-error ScopedAsk remains visible until a scoped handler removes it.
    const runnable: Fx<never, string> = program

    assert.equal(effectIsAny, false)
    assert.equal(effectIsScopedAsk, true)
    void runnable
  })
})
