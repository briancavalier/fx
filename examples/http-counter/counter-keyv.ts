import Keyv from 'keyv'
import { Async, Fx, assertSync, bracket, fx, handle } from '../../src'
import { Next } from './counter'

// Not transactional or parameterized, but just to show how to implement
// another handler for the Counter effect

export const keyvCounter = <E, A>(f: Fx<E, A>) => bracket(
  assertSync(() => new Keyv<number>('sqlite://http-counter.sqlite')),
  db => Async.assertPromise(() => db.disconnect()),
  db => f.pipe(
    handle(Next, key => fx(function* () {
      const value = (yield* get(db, key)) + 1
      yield* set(db, key, value)
      return value
    })
    ))
)

const get = (db: Keyv<number>, key: string) =>
  Async.assertPromise(async _ => await db.get(key) ?? 0)

const set = (db: Keyv<number>, key: string, value: number) =>
  Async.assertPromise(_ => db.set(key, value))
