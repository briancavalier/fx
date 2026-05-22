import { at } from './Breadcrumb.js'
import { Effect, withOrigin } from './Effect.js'
import { Fx } from './Fx.js'
import { handle } from './Handler.js'

export const CodecKeyTypeId: unique symbol = Symbol('fx/Codec/key')

export interface CodecKeyMetadata {
  readonly description?: string
}

export type CodecKey<A, Encoded, Id extends string | symbol = string | symbol> =
  CodecKeyMetadata & {
  readonly [CodecKeyTypeId]: {
    readonly value: A
    readonly encoded: Encoded
  }
  readonly id: Id
}

export type AnyCodecKey = CodecKey<any, any, any>

/**
 * Create a codec key with a string or symbol identity and optional metadata.
 */
export const codecKey = <A, Encoded>() =>
  <const Id extends string | symbol>(id: Id, metadata: CodecKeyMetadata = {}): CodecKey<A, Encoded, Id> =>
    Object.defineProperty({
      ...metadata,
      id
    }, CodecKeyTypeId, {
      value: undefined,
      enumerable: false,
      writable: false,
      configurable: false
    }) as CodecKey<A, Encoded, Id>

export type CodecValue<K> =
  K extends CodecKey<infer A, any, any> ? A : never

export type CodecEncoded<K> =
  K extends CodecKey<any, infer Encoded, any> ? Encoded : never

export type CodecImplementation<K extends AnyCodecKey, EncodeEffects = never, DecodeEffects = never> = {
  readonly encode: Encoder<K, EncodeEffects>
  readonly decode: Decoder<K, DecodeEffects>
}

export type Encoder<K extends AnyCodecKey, E = never> =
  (value: CodecValue<K>) => Fx<E, CodecEncoded<K>>

export type Decoder<K extends AnyCodecKey, E = never> =
  (encoded: CodecEncoded<K>) => Fx<E, CodecValue<K>>

/**
 * Request encoding a value with a branded codec key.
 */
export class Encode<const K extends AnyCodecKey> extends Effect('fx/Codec/Encode')<{
  readonly codec: K
  readonly value: CodecValue<K>
}, CodecEncoded<K>> { }

/**
 * Request decoding an encoded value with a branded codec key.
 */
export class Decode<const K extends AnyCodecKey> extends Effect('fx/Codec/Decode')<{
  readonly codec: K
  readonly encoded: CodecEncoded<K>
}, CodecValue<K>> { }

/**
 * Encode a value using the handler associated with the codec key.
 */
export const encode = <const K extends AnyCodecKey>(
  codec: K,
  value: CodecValue<K>
): Fx<Encode<K>, CodecEncoded<K>> =>
  withOrigin(new Encode({ codec, value }), at('fx/Codec/encode', encode))

/**
 * Decode an encoded value using the handler associated with the codec key.
 */
export const decode = <const K extends AnyCodecKey>(
  codec: K,
  encoded: CodecEncoded<K>
): Fx<Decode<K>, CodecValue<K>> =>
  withOrigin(new Decode({ codec, encoded }), at('fx/Codec/decode', decode))

export type WithCodec<E, K extends AnyCodecKey, HandlerEffects = never> =
  E extends Encode<infer EK> ? HandleKeyedCodecEffect<E, EK, K, HandlerEffects>
  : E extends Decode<infer DK> ? HandleKeyedCodecEffect<E, DK, K, HandlerEffects>
  : E

export type WithEncoder<E, K extends AnyCodecKey, HandlerEffects = never> =
  E extends Encode<infer EK> ? HandleKeyedCodecEffect<E, EK, K, HandlerEffects> : E

export type WithDecoder<E, K extends AnyCodecKey, HandlerEffects = never> =
  E extends Decode<infer DK> ? HandleKeyedCodecEffect<E, DK, K, HandlerEffects> : E

/**
 * Handle encode requests for the matching codec key.
 */
export const withEncoder = <const K extends AnyCodecKey, EncodeEffects = never>(
  codec: K,
  encode: Encoder<K, EncodeEffects>
) =>
  <const E, const A>(fx: Fx<E, A>): Fx<WithEncoder<E, K, EncodeEffects>, A> =>
    fx.pipe(
      handle(Encode, effect =>
        (Object.is(effect.arg.codec.id, codec.id)
          ? encode(effect.arg.value as CodecValue<K>)
          : effect as Fx<typeof effect, CodecEncoded<typeof effect.arg.codec>>
        ) as Fx<EncodeEffects | Encode<AnyCodecKey>, CodecEncoded<typeof effect.arg.codec>>)
    ) as Fx<WithEncoder<E, K, EncodeEffects>, A>

/**
 * Handle decode requests for the matching codec key.
 */
export const withDecoder = <const K extends AnyCodecKey, DecodeEffects = never>(
  codec: K,
  decode: Decoder<K, DecodeEffects>
) =>
  <const E, const A>(fx: Fx<E, A>): Fx<WithDecoder<E, K, DecodeEffects>, A> =>
    fx.pipe(
      handle(Decode, effect =>
        (Object.is(effect.arg.codec.id, codec.id)
          ? decode(effect.arg.encoded as CodecEncoded<K>)
          : effect as Fx<typeof effect, CodecValue<typeof effect.arg.codec>>
        ) as Fx<DecodeEffects | Decode<AnyCodecKey>, CodecValue<typeof effect.arg.codec>>)
    ) as Fx<WithDecoder<E, K, DecodeEffects>, A>

/**
 * Handle encode and decode requests for the matching codec key.
 */
export const withCodec = <const K extends AnyCodecKey, EncodeEffects = never, DecodeEffects = never>(
  codec: K,
  { encode, decode }: CodecImplementation<K, EncodeEffects, DecodeEffects>
) =>
  <const E, const A>(fx: Fx<E, A>): Fx<WithCodec<E, K, EncodeEffects | DecodeEffects>, A> =>
    fx.pipe(
      withEncoder(codec, encode),
      withDecoder(codec, decode)
    ) as Fx<WithCodec<E, K, EncodeEffects | DecodeEffects>, A>

type HandleKeyedCodecEffect<E, EffectKey extends AnyCodecKey, HandledKey extends AnyCodecKey, HandlerEffects> =
  IsExact<EffectKey, HandledKey> extends true ? HandlerEffects
  : Extract<EffectKey, HandledKey> extends never ? E
  : E | HandlerEffects

type IsExact<A, B> =
  [A] extends [B]
    ? [B] extends [A] ? true : false
    : false
