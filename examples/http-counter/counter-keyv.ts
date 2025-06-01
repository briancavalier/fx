import Keyv from 'keyv'
import { Async, Fx, bracket, fx, handle, trySync } from '../../src'
import { Next } from './counter'

// Not transactional or parameterized, but just to show how to implement
// another handler for the Counter effect

export const keyvCounter = <E, A>(f: Fx<E, A>) => bracket(
  trySync(() => new Keyv<number>('sqlite://http-counter.sqlite')),
  db => Async.tryPromise(() => db.disconnect()),
  db => f.pipe(
    handle(Next, key => fx(function* () {
      const value = (yield* get(db, key)) + 1
      yield* set(db, key, value)
      return value
    })
    ))
)

const get = (db: Keyv<number>, key: string) =>
  Async.tryPromise(async _ => await db.get(key) ?? 0)

const set = (db: Keyv<number>, key: string, value: number) =>
  Async.tryPromise(_ => db.set(key, value))
