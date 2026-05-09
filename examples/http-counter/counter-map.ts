import { Fx, handle, ok } from '../../src/index.js'
import { Next } from './counter.js'

// A simple in-memory Counter backed by a Map

export const mapCounter = <E, A>(f: Fx<E, A>) => {
  const store = new Map<string, number>()
  return f.pipe(
    handle(Next, key => {
      const value = (store.get(key) ?? 0) + 1
      store.set(key, value)
      return ok(value)
    })
  )
}
