import { KeyTypeId, keyId, sameKey, type KeyIdentity } from './internal/keyIdentity.js'

export { keyId, sameKey }

export interface KeyMetadata {
  readonly label?: string
}

export interface Key<Id extends PropertyKey = PropertyKey> extends KeyIdentity<Id> {
  readonly label?: string
}

export type AnyKey = Key<PropertyKey>

export function key<Brand>(): <const Id extends PropertyKey>(id: Id & SingletonKeyId<Id>, metadata?: KeyMetadata) => Key<Id> & Brand
export function key<const Id extends PropertyKey>(id: Id & SingletonKeyId<Id>, metadata?: KeyMetadata): Key<Id>
export function key(id?: PropertyKey, metadata: KeyMetadata = {}): any {
  if (id === undefined) return key
  const token = { ...metadata }
  Object.defineProperty(token, KeyTypeId, {
    value: id,
    enumerable: false,
    writable: false,
    configurable: false
  })
  return token
}

export const keyLabel = (key: AnyKey): string =>
  key.label ?? String(keyId(key))

type SingletonKeyId<Id extends PropertyKey> =
  string extends Id ? never
  : number extends Id ? never
  : symbol extends Id ? never
  : IsUnion<Id> extends true ? never
  : Id

type IsUnion<T, U = T> =
  T extends unknown
  ? [U] extends [T] ? false : true
  : false
