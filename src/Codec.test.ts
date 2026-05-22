import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Fail, fail, returnFail } from './Fail.js'
import { Fx, fx, ok, run } from './Fx.js'

import {
  codecKey,
  CodecEncoded,
  CodecValue,
  Decode,
  decode,
  Encode,
  encode,
  withCodec,
  withDecoder,
  withEncoder
} from './Codec.js'

type User = {
  readonly id: string
  readonly name: string
}

const UserJsonSymbol = Symbol('UserJson')
const OtherUserJsonSymbol = Symbol('OtherUserJson')
const UserJson = codecKey<User, string>()(UserJsonSymbol, {
  description: 'User encoded as JSON'
})
const OtherUserJson = codecKey<User, string>()(OtherUserJsonSymbol)
const CountText = codecKey<number, string>()('CountText')

class InvalidCodec extends Error { }

type EffectsOf<T> =
  T extends Fx<infer E, any> ? E : never

describe('Codec', () => {
  it('encode yields the encoded type for a codec key', () => {
    const encoded: Fx<Encode<typeof UserJson>, CodecEncoded<typeof UserJson>> =
      encode(UserJson, { id: 'u1', name: 'Ada' } satisfies CodecValue<typeof UserJson>)

    assert.throws(() => run(encoded as any), /Unhandled effect in run/)
  })

  it('decode yields the value type for a codec key', () => {
    const decoded: Fx<Decode<typeof UserJson>, CodecValue<typeof UserJson>> =
      decode(UserJson, '{"id":"u1","name":"Ada"}' satisfies CodecEncoded<typeof UserJson>)

    assert.throws(() => run(decoded as any), /Unhandled effect in run/)
  })

  it('withCodec handles matching encode and decode keys', () => {
    const program = fx(function* () {
      const user = yield* decode(UserJson, '{"id":"u1","name":"Ada"}')
      return yield* encode(UserJson, { ...user, name: user.name.toUpperCase() })
    })

    const actual = program.pipe(
      withCodec(UserJson, {
        encode: user => ok(JSON.stringify(user)),
        decode: json => ok(JSON.parse(json) as User)
      }),
      run
    )

    assert.deepEqual(JSON.parse(actual), { id: 'u1', name: 'ADA' })
  })

  it('creates codec keys with string or symbol identity and metadata', () => {
    assert.equal(UserJson.id, UserJsonSymbol)
    assert.equal(UserJson.description, 'User encoded as JSON')
    assert.equal(CountText.id, 'CountText')
  })

  it('preserves non-matching codec keys as unhandled effects', () => {
    const program = fx(function* () {
      const user = yield* decode(UserJson, '{"id":"u1","name":"Ada"}')
      const count = yield* decode(CountText, '1')
      return `${user.name}:${count}`
    }).pipe(
      withCodec(UserJson, {
        encode: user => ok(JSON.stringify(user)),
        decode: json => ok(JSON.parse(json) as User)
      })
    )

    const residual: Fx<Decode<typeof CountText>, string> = program
    assert.throws(() => run(residual as any), /Unhandled effect in run/)
  })

  it('preserves distinct codec key identities with the same value and encoded types', () => {
    const program = decode(OtherUserJson, '{"id":"u2","name":"Grace"}').pipe(
      withDecoder(UserJson, json => ok(JSON.parse(json) as User))
    )

    const residual: Fx<Decode<typeof OtherUserJson>, User> = program
    const residualEffect: EffectsOf<typeof program> =
      new Decode({ codec: OtherUserJson, encoded: '{"id":"u2","name":"Grace"}' })

    assert.equal(residualEffect.arg.codec.id, OtherUserJsonSymbol)
    assert.throws(() => run(residual as any), /Unhandled effect in run/)
  })

  it('preserves effects when the handler codec key type is widened', () => {
    const expected = new InvalidCodec('widened handler may fail')
    const widen = (codec: typeof UserJson | typeof OtherUserJson): typeof UserJson | typeof OtherUserJson =>
      codec
    const widened = widen(UserJson)

    const program = decode(OtherUserJson, '{"id":"u2","name":"Grace"}').pipe(
      withDecoder(widened, () => fail(expected))
    )

    const residual: Fx<Decode<typeof OtherUserJson> | Fail<InvalidCodec>, User> = program
    assert.throws(() => run(residual as any), /Unhandled effect in run/)
  })

  it('matches different codec key objects with the same identity', () => {
    const SameCountText = codecKey<number, string>()('CountText', {
      description: 'Same codec identity with different metadata'
    })

    const actual = decode(CountText, '41').pipe(
      withDecoder(SameCountText, text => ok(Number(text))),
      run
    )

    assert.equal(actual, 41)
  })

  it('propagates provider failures as Fail', () => {
    const expected = new InvalidCodec('invalid user')

    const actual = decode(UserJson, '{}').pipe(
      withCodec(UserJson, {
        encode: user => ok(JSON.stringify(user)),
        decode: () => fail(expected)
      }),
      returnFail,
      run
    )

    assert.ok(actual instanceof Fail)
    assert.equal(actual.arg, expected)
  })

  it('supports string codec keys', () => {
    const actual = fx(function* () {
      const count = yield* decode(CountText, '41')
      return yield* encode(CountText, count + 1)
    }).pipe(
      withCodec(CountText, {
        encode: count => ok(String(count)),
        decode: text => ok(Number(text))
      }),
      run
    )

    assert.equal(actual, '42')
  })

  it('withDecoder handles only matching decode keys', () => {
    const actual = decode(UserJson, '{"id":"u1","name":"Ada"}').pipe(
      withDecoder(UserJson, json => ok(JSON.parse(json) as User)),
      run
    )

    assert.deepEqual(actual, { id: 'u1', name: 'Ada' })
  })

  it('withDecoder leaves matching encode keys visible', () => {
    const program = encode(UserJson, { id: 'u1', name: 'Ada' }).pipe(
      withDecoder(UserJson, json => ok(JSON.parse(json) as User))
    )

    const residual: Fx<Encode<typeof UserJson>, string> = program
    assert.throws(() => run(residual as any), /Unhandled effect in run/)
  })

  it('withEncoder handles only matching encode keys', () => {
    const actual = encode(UserJson, { id: 'u1', name: 'Ada' }).pipe(
      withEncoder(UserJson, user => ok(JSON.stringify(user))),
      run
    )

    assert.deepEqual(JSON.parse(actual), { id: 'u1', name: 'Ada' })
  })

  it('withEncoder leaves matching decode keys visible', () => {
    const program = decode(UserJson, '{"id":"u1","name":"Ada"}').pipe(
      withEncoder(UserJson, user => ok(JSON.stringify(user)))
    )

    const residual: Fx<Decode<typeof UserJson>, User> = program
    assert.throws(() => run(residual as any), /Unhandled effect in run/)
  })
})
