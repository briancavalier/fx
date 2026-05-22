# Use Codecs

Use this when application logic needs to encode or decode external data without
depending directly on a schema library.

```ts
import { fail, fx, ok, run, trySync } from "@briancavalier/fx"
import { codecKey, decode, encode, withCodec } from "@briancavalier/fx/codec"

type User = {
  readonly id: string
  readonly name: string
}

const UserJson = codecKey<User, string>()("UserJson", {
  description: "User encoded as JSON"
})

const program = (input: string) => fx(function* () {
  const user = yield* decode(UserJson, input)
  return yield* encode(UserJson, { ...user, name: user.name.toUpperCase() })
})
```

A codec key is both a runtime identity and a phantom type. Use `codecKey` with
a string literal or a `const` symbol so TypeScript preserves the specific key
identity. You can attach metadata such as `description` for diagnostics and
documentation. The handler matches the key identity with `Object.is`, while
TypeScript tracks the decoded and encoded types.

Handler pipeline:

```ts
program(input).pipe(
  withCodec(UserJson, {
    encode: user => ok(JSON.stringify(user)),
    decode: text => trySync(() => JSON.parse(text) as User)
  }),
  run
)
```

Use `withDecoder` when a boundary only reads external data. Use `withEncoder`
when it only writes external data. Use `withCodec` when the same boundary needs
both directions.

Recoverable parse, validation, and schema errors should become `Fail`, either
directly with `fail` or by wrapping throwing APIs with `trySync` or
`tryPromise`.

Adapters can stay local to the boundary:

```ts
const fromZodResult = <A>(result: z.ZodSafeParseResult<A>) =>
  result.success ? ok(result.data) : fail(result.error)

const withZodUserJson = withCodec(UserJson, {
  encode: user => fromZodResult(z.safeEncode(userJsonCodec, user)),
  decode: text => fromZodResult(z.safeDecode(userJsonCodec, text))
})
```

```ts
const withEffectUserJson = withCodec(UserJson, {
  encode: user => fromEither(Schema.encodeEither(userJsonSchema)(user)),
  decode: text => fromEither(Schema.decodeUnknownEither(userJsonSchema)(text))
})
```

Standard Schema is a good future target for decoder adapters because it
standardizes `validate`, input/output types, and issues. It does not standardize
runtime encoding, so it should not define the bidirectional codec abstraction.

Common mistake: putting a schema DSL or registry in core. Keep schema-specific
code at the boundary and expose only the codec key to reusable programs.
