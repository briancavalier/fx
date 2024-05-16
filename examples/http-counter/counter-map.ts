import { Fx, handle, ok } from '../../src'
import { Increment } from './counter'

// A simple in-memory counter backed by a Map

export const mapCounter = <E, A>(f: Fx<E, A>) => {
  const store = new Map<string, number>()
  return f.pipe(
    handle(Increment, key => {
      const value = (store.get(key) ?? 0) + 1
      store.set(key, value)
      return ok(value)
    })
  )
}
