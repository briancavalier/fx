import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { effects } from './Effect.js'
import { fx, ok, run, type Fx } from './Fx.js'
import { handle } from './Handler.js'

type EffectOf<T> = T extends Fx<infer E, unknown> ? E : never
type IsAny<T> = 0 extends 1 & T ? true : false

type User = {
  readonly id: string
  readonly name: string
}

const UserEffects = effects('test/EffectNamespace/User')<{
  readonly find: (id: string) => User | undefined
  readonly save: (user: User, overwrite: boolean) => User
  readonly current: () => User
}>()

describe('effects', () => {
  it('creates cached callable effect constructors from operation signatures', () => {
    assert.equal(UserEffects.find, UserEffects.find)
    assert.equal(UserEffects.find._fxEffectId, 'test/EffectNamespace/User/find')
    assert.equal(UserEffects.save._fxEffectId, 'test/EffectNamespace/User/save')
    assert.equal(UserEffects.current._fxEffectId, 'test/EffectNamespace/User/current')
  })

  it('constructs effects with zero, one, and multiple arguments', () => {
    const user = { id: 'user-1', name: 'Ada' }
    const find = UserEffects.find('user-1')
    const save = UserEffects.save(user, true)
    const current = UserEffects.current()

    assert.ok(UserEffects.find.is(find))
    assert.ok(!UserEffects.find.is(save))
    assert.ok(UserEffects.save.is(save))
    assert.ok(UserEffects.current.is(current))
    assert.equal(find.arg, 'user-1')
    assert.deepEqual(save.arg, [user, true])
    assert.equal(current.arg, undefined)
  })

  it('also supports constructor calls for EffectType compatibility', () => {
    const find = new UserEffects.find('user-1')

    assert.ok(UserEffects.find.is(find))
    assert.equal(find._fxEffectId, 'test/EffectNamespace/User/find')
    assert.equal(find.arg, 'user-1')
  })

  it('preserves yield, handler, and runtime behavior', () => {
    const program = fx(function* () {
      const user = yield* UserEffects.find('user-1')
      const saved = yield* UserEffects.save(user ?? { id: 'missing', name: 'Missing' }, true)
      const current = yield* UserEffects.current()

      return `${saved.id}:${current.id}`
    })

    const handled = program.pipe(
      handle(UserEffects.find, effect => ok({ id: effect.arg, name: 'Ada' })),
      handle(UserEffects.save, effect => ok(effect.arg[0])),
      handle(UserEffects.current, () => ok({ id: 'current', name: 'Current' }))
    )

    assert.equal(run(handled), 'user-1:current')
  })

  it('preserves effect namespace inference', () => {
    const program = fx(function* () {
      const user = yield* UserEffects.find('user-1')
      const saved = yield* UserEffects.save(user ?? { id: 'missing', name: 'Missing' }, true)
      const current = yield* UserEffects.current()

      const maybeUser: User | undefined = user
      const savedUser: User = saved
      const currentUser: User = current

      return `${maybeUser?.id ?? savedUser.id}:${currentUser.id}`
    })

    type ProgramEffect = EffectOf<typeof program>

    const effectIsAny: IsAny<ProgramEffect> = false
    const effectIncludesFind: ReturnType<typeof UserEffects.find> extends ProgramEffect ? true : false = true
    const effectIncludesSave: ReturnType<typeof UserEffects.save> extends ProgramEffect ? true : false = true
    const effectIncludesCurrent: ReturnType<typeof UserEffects.current> extends ProgramEffect ? true : false = true

    const handled = program.pipe(
      handle(UserEffects.find, effect => {
        const id: string = effect.arg
        return ok({ id, name: 'Ada' })
      }),
      handle(UserEffects.save, effect => {
        const arg: readonly [User, boolean] = effect.arg
        return ok(arg[0])
      }),
      handle(UserEffects.current, effect => {
        const arg: void = effect.arg
        assert.equal(arg, undefined)
        return ok({ id: 'current', name: 'Current' })
      })
    )

    const runnable: Fx<never, string> = handled

    assert.equal(effectIsAny, false)
    assert.equal(effectIncludesFind, true)
    assert.equal(effectIncludesSave, true)
    assert.equal(effectIncludesCurrent, true)
    void runnable
  })

  it('rejects unknown operations and invalid arguments at compile time', () => {
    // @ts-expect-error Unknown operation names are not part of the namespace.
    assert.equal(typeof UserEffects.missing, 'function')

    // @ts-expect-error find requires a string id.
    UserEffects.find(1)

    // @ts-expect-error save requires both user and overwrite arguments.
    UserEffects.save({ id: 'user-1', name: 'Ada' })

    // @ts-expect-error current does not accept arguments.
    UserEffects.current('extra')

    assert.ok(true)
  })
})
