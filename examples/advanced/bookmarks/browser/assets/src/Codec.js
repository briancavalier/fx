import { at } from './Breadcrumb.js';
import { Effect, withOrigin } from './Effect.js';
import { fail } from './Fail.js';
import { flatMap, ok } from './Fx.js';
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
export const codecOk = (value) => ({ tag: 'ok', value });
export const codecFail = (error) => ({ tag: 'fail', error });
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
 * Encode a value and translate codec failure results into Fail.
 */
export const encodeOrFail = (codec, value) => encode(codec, value).pipe(flatMap(codecResultOrFail));
/**
 * Decode an encoded value using the handler associated with the codec key.
 */
export const decode = (codec, encoded) => withOrigin(new Decode({ codec, encoded }), at('fx/Codec/decode', decode));
/**
 * Decode an encoded value and translate codec failure results into Fail.
 */
export const decodeOrFail = (codec, encoded) => decode(codec, encoded).pipe(flatMap(codecResultOrFail));
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
const codecResultOrFail = (result) => result.tag === 'ok'
    ? ok(result.value)
    : fail(result.error);
