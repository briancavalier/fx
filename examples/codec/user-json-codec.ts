import { Either, Schema } from 'effect'
import { z } from 'zod'

import { Fail, fail, fx, ok, returnFail, run } from '../../src/exports/index.js'
import {
  CodecError,
  CodecEncoded,
  CodecKey,
  decode,
  encode,
  withCodec
} from '../../src/exports/codec.js'

type User = {
  readonly id: string
  readonly name: string
  readonly createdAt: Date
}

const ZodUserJson = Symbol('ZodUserJson') as CodecKey<User, string>
const EffectUserJson = Symbol('EffectUserJson') as CodecKey<User, string>

const incomingJson = JSON.stringify({
  id: 'user-1',
  name: 'Ada',
  createdAt: '2026-05-21T12:00:00.000Z'
})

const invalidJson = JSON.stringify({
  id: 'user-1',
  name: 123,
  createdAt: 'not-a-date'
})

const roundTrip = <K extends CodecKey<User, string>>(codec: K, input: CodecEncoded<K>) =>
  fx(function* () {
    const user = yield* decode(codec, input)
    return yield* encode(codec, { ...user, name: user.name.toUpperCase() })
  })

const zodStringToDate = z.codec(z.iso.datetime(), z.date(), {
  decode: isoString => new Date(isoString),
  encode: date => date.toISOString()
})

const zodUser = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: zodStringToDate
})

const zodUserJson = z.codec(z.string(), zodUser, {
  decode: (text, context) => {
    try {
      return JSON.parse(text) as z.input<typeof zodUser>
    } catch (cause) {
      context.issues.push({
        code: 'invalid_format',
        format: 'json',
        input: text,
        message: cause instanceof Error ? cause.message : 'Invalid JSON'
      })

      return z.NEVER
    }
  },
  encode: user => JSON.stringify(user)
})

const fromZodResult = <const A>(
  message: string,
  result: z.ZodSafeParseResult<A>
) =>
  result.success
    ? ok(result.data)
    : fail(new CodecError(message, { cause: result.error }))

const fromEffectEither = <const A, const E>(
  message: string,
  result: Either.Either<A, E>
) =>
  Either.isRight(result)
    ? ok(result.right)
    : fail(new CodecError(message, { cause: result.left }))

const withZodUserJson = withCodec(ZodUserJson, {
  encode: user => fromZodResult('Zod failed to encode User JSON', z.safeEncode(zodUserJson, user)),
  decode: text => fromZodResult('Zod failed to decode User JSON', z.safeDecode(zodUserJson, text))
})

const effectUserJson = Schema.parseJson(Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.Date
}))

const withEffectUserJson = withCodec(EffectUserJson, {
  encode: user => fromEffectEither('Effect Schema failed to encode User JSON', Schema.encodeEither(effectUserJson)(user)),
  decode: text => fromEffectEither('Effect Schema failed to decode User JSON', Schema.decodeUnknownEither(effectUserJson)(text))
})

const summarizeUserJson = (json: string) => {
  const user = JSON.parse(json) as { readonly id: string; readonly name: string; readonly createdAt: string }
  return `${user.id}:${user.name}:${user.createdAt}`
}

const summarizeFailure = (result: User | Fail<CodecError>) =>
  result instanceof Fail
    ? `${result.arg.name}: ${result.arg.message}`
    : 'unexpected success'

const expectEncoded = (result: string | Fail<CodecError>) => {
  if (result instanceof Fail) throw result.arg
  return result
}

const zodEncoded = roundTrip(ZodUserJson, incomingJson).pipe(withZodUserJson, returnFail, run, expectEncoded)
const effectEncoded = roundTrip(EffectUserJson, incomingJson).pipe(withEffectUserJson, returnFail, run, expectEncoded)
const zodInvalid = decode(ZodUserJson, invalidJson).pipe(withZodUserJson, returnFail, run)
const effectInvalid = decode(EffectUserJson, invalidJson).pipe(withEffectUserJson, returnFail, run)

console.log('zod ok', summarizeUserJson(zodEncoded))
console.log('effect ok', summarizeUserJson(effectEncoded))
console.log('zod invalid', summarizeFailure(zodInvalid))
console.log('effect invalid', summarizeFailure(effectInvalid))
