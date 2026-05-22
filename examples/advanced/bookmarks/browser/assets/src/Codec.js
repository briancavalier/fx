import { at } from './Breadcrumb.js';
import { Effect, withOrigin } from './Effect.js';
import { handle } from './Handler.js';
export const CodecKeyTypeId = Symbol('fx/Codec/key');
/**
 * Create a codec key with a string or symbol identity and optional metadata.
 */
export const codecKey = () => (id, metadata = {}) => Object.defineProperty({
    ...metadata,
    id
}, CodecKeyTypeId, {
    value: undefined,
    enumerable: false,
    writable: false,
    configurable: false
});
/**
 * Request encoding a value with a branded codec key.
 */
export class Encode extends Effect('fx/Codec/Encode') {
}
/**
 * Request decoding an encoded value with a branded codec key.
 */
export class Decode extends Effect('fx/Codec/Decode') {
}
/**
 * Encode a value using the handler associated with the codec key.
 */
export const encode = (codec, value) => withOrigin(new Encode({ codec, value }), at('fx/Codec/encode', encode));
/**
 * Decode an encoded value using the handler associated with the codec key.
 */
export const decode = (codec, encoded) => withOrigin(new Decode({ codec, encoded }), at('fx/Codec/decode', decode));
/**
 * Handle encode requests for the matching codec key.
 */
export const withEncoder = (codec, encode) => (fx) => fx.pipe(handle(Encode, effect => (Object.is(effect.arg.codec.id, codec.id)
    ? encode(effect.arg.value)
    : effect)));
/**
 * Handle decode requests for the matching codec key.
 */
export const withDecoder = (codec, decode) => (fx) => fx.pipe(handle(Decode, effect => (Object.is(effect.arg.codec.id, codec.id)
    ? decode(effect.arg.encoded)
    : effect)));
/**
 * Handle encode and decode requests for the matching codec key.
 */
export const withCodec = (codec, { encode, decode }) => (fx) => fx.pipe(withEncoder(codec, encode), withDecoder(codec, decode));
