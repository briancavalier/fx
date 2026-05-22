# Use Codecs

Use this when application logic needs to encode or decode external data without
depending directly on a schema library.

```ts
import { fx, ok, returnAll, run } from "@briancavalier/fx"
import { codecFail, codecKey, codecOk, decodeOrFail, encodeOrFail, withCodec } from "@briancavalier/fx/codec"

type User = {
  readonly id: string
  readonly name: string
}

class InvalidUserJson extends Error { }

const UserJson = codecKey<User, string, InvalidUserJson>()("UserJson", {
  description: "User encoded as JSON"
})

const program = (input: string) => fx(function* () {
  const user = yield* decodeOrFail(UserJson, input)
  return yield* encodeOrFail(UserJson, { ...user, name: user.name.toUpperCase() })
})
```

A codec key is both a runtime identity and a phantom type. Use `codecKey` with
a string literal or a `const` symbol so TypeScript preserves the specific key
identity. You can attach metadata such as `description` for diagnostics and
documentation. The handler matches the key identity with `Object.is`, while
TypeScript tracks the decoded type, encoded type, and declared recoverable
codec failures. The third type parameter declares decode failures; the fourth
type parameter can declare a different encode failure type when needed.

Handler pipeline:

```ts
program(input).pipe(
  withCodec(UserJson, {
    encode: user => ok(codecOk(JSON.stringify(user))),
    decode: text => {
      try {
        return ok(codecOk(JSON.parse(text) as User))
      } catch {
        return ok(codecFail(new InvalidUserJson()))
      }
    }
  }),
  returnAll,
  run
)
```

Use `withDecoder` when a boundary only reads external data. Use `withEncoder`
when it only writes external data. Use `withCodec` when the same boundary needs
both directions.

Codec handlers return `CodecResult` values. Use `codecOk` for successful
answers and `codecFail` for declared codec failures. Operations such as
`decodeOrFail` and `encodeOrFail` translate failed codec results into `Fail`;
plain `decode` and `encode` return the handler answer directly.

Adapters can stay local to the boundary:

```ts
const fromZodResult = <A>(result: z.ZodSafeParseResult<A>) =>
  ok(result.success ? codecOk(result.data) : codecFail(result.error))

const withZodUserJson = withCodec(UserJson, {
  encode: user => fromZodResult(z.safeEncode(userJsonCodec, user)),
  decode: text => fromZodResult(z.safeDecode(userJsonCodec, text))
})
```

```ts
const fromEither = <E, A>(either: Either<E, A>) =>
  ok(Either.isRight(either) ? codecOk(either.right) : codecFail(either.left))

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
