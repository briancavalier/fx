import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect, finalizing, fx, ScopedEffect, type Fx } from '@briancavalier/fx'
import * as fxApi from '@briancavalier/fx'
import * as concurrentApi from '@briancavalier/fx/concurrent'
import * as scopeApi from '@briancavalier/fx/scope'
import * as stateApi from '@briancavalier/fx/state'
import * as timeoutApi from '@briancavalier/fx/timeout'
import * as yieldApi from '@briancavalier/fx/yield'
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
import { andFinallyIn, inScope, sameScope, scope, scopeId, scopeLabel, usingIn, usingManagedIn, withScope, type AnyScope } from '@briancavalier/fx/scope'
import { getState, modifyState, transactionalState } from '@briancavalier/fx/state'
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

    assert.equal(typeof scopeId, 'function')
    assert.equal(typeof scopeLabel, 'function')
    assert.equal(typeof sameScope, 'function')
    assert.equal(typeof withScope, 'function')
    assert.equal(typeof inScope, 'function')
    assert.equal(typeof andFinallyIn, 'function')
    assert.equal(typeof usingIn, 'function')
    assert.equal(typeof usingManagedIn, 'function')
    assert.equal(typeof finalizing, 'function')

    assert.equal(typeof getState, 'function')
    assert.equal(typeof modifyState, 'function')
    assert.equal(typeof transactionalState, 'function')

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
    const hasScopeConstructor: HasExport<typeof scopeApi, `sc${'ope'}`> = true
    const noScopeFinalizing: HasExport<typeof scopeApi, `final${'izing'}`> = false
    const noRunCatchScoped: HasExport<typeof fxApi, `runCatch${'Scoped'}`> = false
    const noCheckpointMain: HasExport<typeof fxApi, `check${'point'}`> = false
    const noCheckpointRequestMain: HasExport<typeof fxApi, `Check${'point'}`> = false
    const noCheckpointRequest: HasExport<typeof stateApi, `Check${'point'}`> = false
    const noCheckpointConstructor: HasExport<typeof stateApi, `check${'point'}`> = false
    const noCheckpointedState: HasExport<typeof stateApi, `with${'Checkpointed'}State`> = false
    const noCheckpointedStateInit: HasExport<typeof stateApi, `with${'Checkpointed'}StateInit`> = false
    const noTxState: HasExport<typeof stateApi, `tx${'State'}`> = false
    const noReturnExitMain: HasExport<typeof fxApi, `return${'Exit'}`> = false
    const noResumeExitMain: HasExport<typeof fxApi, `resume${'Exit'}`> = false
    const noReturnExitState: HasExport<typeof stateApi, `return${'Exit'}`> = false
    const noResumeExitState: HasExport<typeof stateApi, `resume${'Exit'}`> = false
    const noReturnExitScope: HasExport<typeof scopeApi, `return${'Exit'}`> = false
    const noResumeExitScope: HasExport<typeof scopeApi, `resume${'Exit'}`> = false
    const noTimeoutInScope: HasExport<typeof timeoutApi, `timeout${'In'}Scope`> = false
    const noYieldFromScope: HasExport<typeof scopeApi, `yield${'From'}`> = false
    const noYieldFromRequestScope: HasExport<typeof scopeApi, `Yield${'From'}`> = false
    const hasYieldFrom: HasExport<typeof yieldApi, `yield${'From'}`> = true
    const hasYieldFromRequest: HasExport<typeof yieldApi, `Yield${'From'}`> = true
    assert.equal(noConcurrentEffect, false)
    assert.equal(noConcurrentConstructor, false)
    assert.equal(noFirstSettled, false)
    assert.equal(noAllPolicy, false)
    assert.equal(noFirstSettledPolicy, false)
    assert.equal(noFirstSuccessPolicy, false)
    assert.equal(noScopeTypeId, false)
    assert.equal(hasScopeConstructor, true)
    assert.equal(noScopeFinalizing, false)
    assert.equal(noRunCatchScoped, false)
    assert.equal(noCheckpointMain, false)
    assert.equal(noCheckpointRequestMain, false)
    assert.equal(noCheckpointRequest, false)
    assert.equal(noCheckpointConstructor, false)
    assert.equal(noCheckpointedState, false)
    assert.equal(noCheckpointedStateInit, false)
    assert.equal(noTxState, false)
    assert.equal(noReturnExitMain, false)
    assert.equal(noResumeExitMain, false)
    assert.equal(noReturnExitState, false)
    assert.equal(noResumeExitState, false)
    assert.equal(noReturnExitScope, false)
    assert.equal(noResumeExitScope, false)
    assert.equal(noTimeoutInScope, false)
    assert.equal(noYieldFromScope, false)
    assert.equal(noYieldFromRequestScope, false)
    assert.equal(hasYieldFrom, true)
    assert.equal(hasYieldFromRequest, true)
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
    class ScopedAsk<const S extends AnyScope> extends ScopedEffect('test/package-import-inference/ScopedAsk')<S, string, string> { }

    const TestScope = scope('test/package-import-inference/ScopedAsk')
    const program = fx(function* () {
      return yield* new ScopedAsk(TestScope, 'name')
    }).pipe(inScope(TestScope))

    {
      const scopedProgram = fx(function* () {
        return yield* new ScopedAsk(TestScope, 'name')
      })
      const effectIsScopedAsk: EffectOf<typeof scopedProgram> extends ScopedAsk<typeof TestScope> ? true : false = true
      assert.equal(effectIsScopedAsk, true)
    }

    const effectIsAny: IsAny<EffectOf<typeof program>> = false

    // @ts-expect-error ScopedAsk remains visible until a scoped handler removes it.
    const runnable: Fx<never, string> = program

    assert.equal(effectIsAny, false)
    void runnable
  })
})
