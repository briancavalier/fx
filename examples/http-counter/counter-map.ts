import { Fx, handle, ok } from '../../src/index.js'
import { Next } from './counter.js'

// A simple in-memory Counter backed by a Map

export const mapCounter = <E, A>(f: Fx<E, A>) => {
  const store = new Map<string, number>()
  return f.pipe(
    handle(Next, next => {
      const value = (store.get(next.arg) ?? 0) + 1
      store.set(next.arg, value)
      return ok(value)
    })
  )
}
