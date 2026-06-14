import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { fork, forkIn, withUnboundedConcurrency } from './Concurrent.js'
import { Fail, catchAll, catchIf, fail, returnFail, runCatch } from './Fail.js'
import { andFinallyIn } from './Finalization.js'
import { finalizing, fx, ok, run, runPromise, type Fx } from './Fx.js'
import { scope, withScope, type Control } from './Scope.js'
import {
  GetState,
  getState,
  modifyState,
  transactionalState,
  withState,
  withStateInit,
  type ModifyState,
  type Stateful
} from './State.js'
import { wait } from './Task.js'

describe('State', () => {
  const CounterState = scope<Stateful<number>>()('test/State/Counter')
  const OtherState = scope<Stateful<string>>()('test/State/Other')
  const ObjectState = scope<Stateful<{ readonly count: number }>>()('test/State/Object')

  it('gets the initial state', () => {
    const program = getState(CounterState).pipe(withState(CounterState, 1), run)

    assert.equal(program, 1)
  })

  it('modifies state and returns the callback result', () => {
    const program = modifyState(CounterState, count => [count + 1, `count:${count}`]).pipe(
      withState(CounterState, 1),
      run
    )

    assert.equal(program, 'count:1')
  })

  it('repeated modifications see prior updates', () => {
    const program = fx(function* () {
      yield* modifyState(CounterState, count => [count + 1, undefined])
      yield* modifyState(CounterState, count => [count + 1, undefined])
      return yield* getState(CounterState)
    }).pipe(withState(CounterState, 1), run)

    assert.equal(program, 3)
  })

  it('keeps different state scopes isolated', () => {
    const program = fx(function* () {
      yield* modifyState(CounterState, count => [count + 1, undefined])
      yield* modifyState(OtherState, value => [`${value}!`, undefined])

      return [yield* getState(CounterState), yield* getState(OtherState)] as const
    }).pipe(
      withState(CounterState, 1),
      withState(OtherState, 'ready'),
      run
    )

    assert.deepEqual(program, [2, 'ready!'])
  })

  it('leaves non-matching state scopes unhandled', () => {
    const program = getState(OtherState).pipe(withState(CounterState, 1))
    const next = program[Symbol.iterator]().next()

    assert.equal(next.done, false)
    assert.equal(GetState.is(next.value), true)
    assert.equal((next.value as GetState<typeof OtherState>).scope, OtherState)
  })

  it('handles same-id state scope tokens', () => {
    const FirstScope = scope<Stateful<number>>()('test/State/SameName')
    const SecondScope = scope<Stateful<number>>()('test/State/SameName')
    const result = getState(SecondScope).pipe(withState(FirstScope, 1), run)

    assert.equal(result, 1)
  })

  it('allocates state per execution', () => {
    const program = modifyState(CounterState, count => [count + 1, count]).pipe(
      withState(CounterState, 1)
    )

    assert.equal(run(program), 1)
    assert.equal(run(program), 1)
  })

  it('runs state initialization once per execution', () => {
    let initialized = 0
    const initial = fx(function* () {
      initialized += 1
      return { count: initialized }
    })
    const program = getState(ObjectState).pipe(withStateInit(ObjectState, initial))

    assert.deepEqual(run(program), { count: 1 })
    assert.deepEqual(run(program), { count: 2 })
  })

  it('preserves initialization effects', () => {
    const initFailure = new Error('init failed')
    const program = getState(CounterState).pipe(
      withStateInit(CounterState, fail(initFailure)),
      returnFail,
      run
    )

    if (!Fail.is(program)) assert.fail('expected initialization failure')
    assert.equal(program.arg, initFailure)
  })

  it('requires withStateInit when initial state is an Fx', () => {
    const initial = ok(1)

    // @ts-expect-error withState expects a state value, not an Fx that produces one.
    getState(CounterState).pipe(withState(CounterState, initial))

    const program = getState(CounterState).pipe(withStateInit(CounterState, initial), run)

    assert.equal(program, 1)
  })

  it('handles state effects requested during scope cleanup', () => {
    let finalizerState = 0
    const program = fx(function* () {
      yield* modifyState(CounterState, count => [count + 1, undefined])
      yield* andFinallyIn(CounterState, fx(function* () {
        finalizerState = yield* modifyState(CounterState, count => [count + 1, count])
      }))

      return yield* getState(CounterState)
    }).pipe(withScope(CounterState), withState(CounterState, 1), returnFail, run)

    assert.equal(program, 2)
    assert.equal(finalizerState, 2)
  })

  it('leaves cleanup state effects typed when withState is inside the scope boundary', () => {
    const program = fx(function* () {
      yield* andFinallyIn(CounterState, modifyState(CounterState, count => [count + 1, undefined]))
      return 'done'
    })
    const wrongOrder = program.pipe(withState(CounterState, 1), withScope(CounterState))
    const rightOrder = program.pipe(withScope(CounterState), withState(CounterState, 1))

    type WrongEffects = typeof wrongOrder extends Fx<infer E, 'done'> ? E : never
    type RightEffects = typeof rightOrder extends Fx<infer E, 'done'> ? E : never
    const cleanupStateIsVisible: Extract<WrongEffects, ModifyState<typeof CounterState, any>> extends never ? false : true = true
    const cleanupStateIsHandled: Extract<RightEffects, ModifyState<typeof CounterState, any>> extends never ? true : false = true
    const cleanupFailureRemains: RightEffects extends Fail<AggregateError> ? true : false = true

    assert.equal(typeof cleanupStateIsVisible, 'boolean')
    assert.equal(typeof cleanupStateIsHandled, 'boolean')
    assert.equal(typeof cleanupFailureRemains, 'boolean')
  })

  describe('transactionalState', () => {
    const ForkScope = scope<Control>()('test/State/Transactional/ForkScope')

    it('commits state when a transactional body succeeds', () => {
      const program = fx(function* () {
        yield* fx(function* () {
          yield* modifyState(CounterState, count => [count + 1, undefined])
          return 'body'
        }).pipe(
          transactionalState(CounterState),
          catchAll(() => ok('recovered')),
          runCatch
        )

        return yield* getState(CounterState)
      }).pipe(withState(CounterState, 0), run)

      assert.equal(program, 1)
    })

    it('rolls back matching failed catch body state before recovery runs', () => {
      const program = fx(function* () {
        const recovered = yield* fx(function* () {
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* fail('body')
          return 'body'
        }).pipe(
          transactionalState(CounterState),
          catchAll(error => fx(function* () {
            const recoveredFrom = yield* getState(CounterState)
            yield* modifyState(CounterState, count => [count + 10, undefined])
            return `${error}:${recoveredFrom}`
          })),
          runCatch
        )

        return [recovered, yield* getState(CounterState)] as const
      }).pipe(withState(CounterState, 0), run)

      assert.deepEqual(program, ['body:0', 10])
    })

    it('rolls back unmatched failed catch body state before an outer recovery runs', () => {
      const isString = (x: unknown): x is string => typeof x === 'string'
      const program = fx(function* () {
        const handled = fx(function* () {
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* fail<string | number>(123)
          return 'body'
        }).pipe(
          transactionalState(CounterState),
          catchIf(isString, ok),
          runCatch,
          catchAll(() => getState(CounterState)),
          runCatch
        )

        return yield* handled
      }).pipe(withState(CounterState, 0), run)

      assert.equal(program, 0)
    })

    it('commits recovery state changes unless an outer transaction rolls them back', () => {
      const program = fx(function* () {
        yield* fail('body').pipe(
          transactionalState(CounterState),
          catchAll(() => modifyState(CounterState, count => [count + 1, undefined])),
          runCatch
        )

        return yield* getState(CounterState)
      }).pipe(withState(CounterState, 0), run)

      assert.equal(program, 1)
    })

    it('rolls back cleanup state changes before recovery runs', () => {
      const program = fx(function* () {
        const recovered = yield* fx(function* () {
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* fail('body')
        }).pipe(
          finalizing(modifyState(CounterState, count => [count + 100, undefined])),
          transactionalState(CounterState),
          catchAll(error => fx(function* () {
            const recoveredFrom = yield* getState(CounterState)
            yield* modifyState(CounterState, count => [count + 10, undefined])
            return `${error}:${recoveredFrom}`
          })),
          runCatch
        )

        return [recovered, yield* getState(CounterState)] as const
      }).pipe(withState(CounterState, 0), run)

      assert.deepEqual(program, ['body:0', 10])
    })

    it('preserves the original failure when transactional cleanup fails', () => {
      const bodyFailure = new Error('body failed')
      const cleanupFailure = new Error('cleanup failed')
      const program = fx(function* () {
        const recovered = yield* fx(function* () {
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* fail(bodyFailure)
        }).pipe(
          finalizing(fx(function* () {
            yield* modifyState(CounterState, count => [count + 100, undefined])
            yield* fail(cleanupFailure)
          })),
          transactionalState(CounterState),
          catchAll(error => fx(function* () {
            const recoveredFrom = yield* getState(CounterState)
            return [error, recoveredFrom] as const
          })),
          runCatch
        )

        return [recovered, yield* getState(CounterState)] as const
      }).pipe(withState(CounterState, 0), run)

      const [recovered, finalState] = program
      if (recovered === undefined) assert.fail('expected recovery')
      const [failure, recoveredFrom] = recovered
      assert.equal(failure, bodyFailure)
      assert.equal(recoveredFrom, 0)
      assert.equal(finalState, 0)
      assert.equal(cleanupFailure.message, 'cleanup failed')
    })

    it('continues draining transactional cleanup after a cleanup failure', () => {
      const events: string[] = []
      const bodyFailure = new Error('body failed')
      const cleanupFailure = new Error('cleanup failed')
      const program = fx(function* () {
        const recovered = yield* fx(function* () {
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* fail(bodyFailure)
        }).pipe(
          finalizing(fx(function* () {
            events.push('failing cleanup')
            yield* fail(cleanupFailure)
          })),
          finalizing(fx(function* () {
            events.push('state cleanup')
            yield* modifyState(CounterState, count => [count + 100, undefined])
          })),
          transactionalState(CounterState),
          catchAll(error => fx(function* () {
            events.push('recovery')
            const recoveredFrom = yield* getState(CounterState)
            return [error, recoveredFrom] as const
          })),
          runCatch
        )

        return [recovered, yield* getState(CounterState)] as const
      }).pipe(withState(CounterState, 0), run)

      const [recovered, finalState] = program
      if (recovered === undefined) assert.fail('expected recovery')
      const [failure, recoveredFrom] = recovered
      assert.equal(failure, bodyFailure)
      assert.deepEqual(events, ['recovery', 'failing cleanup', 'state cleanup'])
      assert.equal(recoveredFrom, 0)
      assert.equal(finalState, 0)
      assert.equal(cleanupFailure.message, 'cleanup failed')
    })

    it('rolls back state changes from joined forked children', async () => {
      const program = fx(function* () {
        const recovered = yield* fx(function* () {
          const task = yield* fork(fx(function* () {
            yield* modifyState(CounterState, count => [count + 10, undefined])
          }))
          yield* wait(task)
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* fail('body')
        }).pipe(
          transactionalState(CounterState),
          catchAll(error => fx(function* () {
            const recoveredFrom = yield* getState(CounterState)
            return `${error}:${recoveredFrom}`
          })),
          runCatch
        )

        return [recovered, yield* getState(CounterState)] as const
      }).pipe(
        withState(CounterState, 0),
        withUnboundedConcurrency
      )

      assert.deepEqual(await program.pipe(runPromise), ['body:0', 0])
    })

    it('commits state changes from joined forked children when the transaction succeeds', async () => {
      const program = fx(function* () {
        yield* fx(function* () {
          const task = yield* fork(fx(function* () {
            yield* modifyState(CounterState, count => [count + 10, undefined])
          }))
          yield* wait(task)
          yield* modifyState(CounterState, count => [count + 1, undefined])
        }).pipe(transactionalState(CounterState))

        return yield* getState(CounterState)
      }).pipe(
        withState(CounterState, 0),
        withUnboundedConcurrency
      )

      assert.equal(await program.pipe(runPromise), 11)
    })

    it('rolls back state changes from joined scoped forked children', async () => {
      const program = fx(function* () {
        const recovered = yield* fx(function* () {
          const task = yield* forkIn(ForkScope, fx(function* () {
            yield* modifyState(CounterState, count => [count + 10, undefined])
          }))
          yield* wait(task)
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* fail('body')
        }).pipe(
          transactionalState(CounterState),
          catchAll(error => fx(function* () {
            const recoveredFrom = yield* getState(CounterState)
            return `${error}:${recoveredFrom}`
          })),
          runCatch
        )

        return [recovered, yield* getState(CounterState)] as const
      }).pipe(
        withScope(ForkScope),
        withState(CounterState, 0),
        withUnboundedConcurrency
      )

      assert.deepEqual(await program.pipe(returnFail, runPromise), ['body:0', 0])
    })

    it('does not roll back state for plain runCatch', () => {
      const program = fx(function* () {
        return yield* fx(function* () {
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* fail('body')
          return 'body'
        }).pipe(
          catchAll(() => getState(CounterState)),
          runCatch
        )
      }).pipe(withState(CounterState, 0), run)

      assert.equal(program, 1)
    })

    it('does not roll back other state scopes', () => {
      const program = fx(function* () {
        return yield* fx(function* () {
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* modifyState(OtherState, value => [`${value}!`, undefined])
          yield* fail('body')
          return 'body'
        }).pipe(
          transactionalState(CounterState),
          catchAll(() => fx(function* () {
            return [yield* getState(CounterState), yield* getState(OtherState)] as const
          })),
          runCatch
        )
      }).pipe(
        withState(CounterState, 0),
        withState(OtherState, 'other'),
        run
      )

      assert.deepEqual(program, [0, 'other!'])
    })

    it('handles same-id state scope tokens', () => {
      const FirstScope = scope<Stateful<number>>()('test/State/Transactional/SameName')
      const SecondScope = scope<Stateful<number>>()('test/State/Transactional/SameName')
      const result = fail('body').pipe(
        transactionalState(SecondScope),
        catchAll(() => getState(SecondScope)),
        runCatch,
        withState(FirstScope, 1),
        run
      )

      assert.equal(result, 1)
    })

    it('commits nested transactions into the outer transaction', () => {
      const program = fx(function* () {
        yield* fx(function* () {
          yield* modifyState(CounterState, count => [count + 1, undefined])
          yield* modifyState(CounterState, count => [count + 10, undefined]).pipe(
            transactionalState(CounterState)
          )
          return yield* getState(CounterState)
        }).pipe(transactionalState(CounterState))

        return yield* getState(CounterState)
      }).pipe(withState(CounterState, 0), run)

      assert.equal(program, 11)
    })

    it('leaves state effects visible until withState handles durable state', () => {
      const program = modifyState(CounterState, count => [count + 1, undefined]).pipe(
        transactionalState(CounterState)
      )
      const next = program[Symbol.iterator]().next()

      assert.equal(next.done, false)
      assert.equal(GetState.is(next.value), true)
    })

    it('requires a stateful scope', () => {
      const PlainScope = scope('test/State/Transactional/Plain')

      // @ts-expect-error transactionalState requires a Stateful scope.
      ok('plain').pipe(transactionalState(PlainScope))

      assert.equal(typeof PlainScope, 'object')
    })

    it('preserves state effect typing until withState handles durable state', () => {
      const scoped = modifyState(CounterState, count => [count + 1, undefined]).pipe(
        transactionalState(CounterState)
      )
      const handled = scoped.pipe(withState(CounterState, 0))
      const otherState = getState(OtherState).pipe(transactionalState(CounterState))

      type ScopedEffects = EffectOf<typeof scoped>
      type HandledEffects = EffectOf<typeof handled>
      type OtherStateEffects = EffectOf<typeof otherState>
      const counterGetVisible: Extract<ScopedEffects, GetState<typeof CounterState>> extends never ? false : true = true
      const counterModifyVisible: Extract<ScopedEffects, ModifyState<typeof CounterState, any>> extends never ? false : true = true
      const counterStateHandled: Extract<HandledEffects, GetState<typeof CounterState> | ModifyState<typeof CounterState, any>> extends never ? true : false = true
      const otherStateVisible: Extract<OtherStateEffects, GetState<typeof OtherState>> extends never ? false : true = true

      assert.equal(counterGetVisible, true)
      assert.equal(counterModifyVisible, true)
      assert.equal(counterStateHandled, true)
      assert.equal(otherStateVisible, true)
    })
  })
})

type EffectOf<F> = F extends Fx<infer E, any> ? E : never
