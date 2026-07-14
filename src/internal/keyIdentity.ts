export const KeyTypeId = Symbol('fx/Key')

export interface KeyIdentity<Identity extends PropertyKey = PropertyKey> {
  readonly [KeyTypeId]: Identity
}

export type AnyKeyIdentity = KeyIdentity<PropertyKey>

export const keyId = <const Key extends AnyKeyIdentity>(key: Key): Key[typeof KeyTypeId] =>
  key[KeyTypeId]

export const sameKey = (a: AnyKeyIdentity, b: AnyKeyIdentity): boolean =>
  keyId(a) === keyId(b)
