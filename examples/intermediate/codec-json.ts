import { Fail, fail, flatMap, ok, returnFail, run, trySync } from '@briancavalier/fx'
import { CodecEncoded, CodecKey, decode, encode, withCodec } from '@briancavalier/fx/codec'

type User = {
  readonly id: string
  readonly name: string
  readonly createdAt: Date
}

const UserJson = Symbol('UserJson') as CodecKey<User, string>

class InvalidUserJson extends Error { }

// This example keeps the codec implementation hand-rolled so it has no
// dependencies. Real handlers can delegate to any schema or codec library, such
// as Zod codecs, Effect Schema, Valibot, Arktype, or a project-local parser.
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
  decode(codec, input).pipe(
    flatMap(user => encode(codec, { ...user, name: user.name.toUpperCase() }))
  )

// The reusable program above only knows about the codec key. The concrete JSON
// parsing, validation, and Date conversion live in the boundary handler below.
const decodeUser = (value: unknown) => {
  if (
    value !== null
    && typeof value === 'object'
    && 'id' in value
    && typeof value.id === 'string'
    && 'name' in value
    && typeof value.name === 'string'
    && 'createdAt' in value
    && typeof value.createdAt === 'string'
  ) {
    const createdAt = new Date(value.createdAt)

    return Number.isNaN(createdAt.getTime())
      ? fail(new InvalidUserJson('createdAt must be an ISO date string'))
      : ok({ id: value.id, name: value.name, createdAt })
  }

  return fail(new InvalidUserJson('expected User JSON object'))
}

const withUserJson = withCodec(UserJson, {
  encode: user =>
    trySync(() => JSON.stringify({
      id: user.id,
      name: user.name,
      createdAt: user.createdAt.toISOString()
    })),
  decode: text =>
    trySync(() => JSON.parse(text) as unknown).pipe(
      flatMap(decodeUser)
    )
})

const summarizeUserJson = (json: string) => {
  const user = JSON.parse(json) as { readonly id: string; readonly name: string; readonly createdAt: string }
  return `${user.id}:${user.name}:${user.createdAt}`
}

const summarizeFailure = (result: User | Fail<unknown>) =>
  result instanceof Fail
    ? `Fail:${result.arg instanceof Error ? result.arg.message : String(result.arg)}`
    : 'unexpected success'

const expectEncoded = (result: string | Fail<unknown>) => {
  if (result instanceof Fail) throw result.arg
  return result
}

const encoded = roundTrip(UserJson, incomingJson).pipe(withUserJson, returnFail, run, expectEncoded)
const invalid = decode(UserJson, invalidJson).pipe(withUserJson, returnFail, run)

console.log('codec ok', summarizeUserJson(encoded))
console.log('codec invalid', summarizeFailure(invalid))
