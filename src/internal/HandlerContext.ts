import { Effect, isEffect } from '../Effect.js'
import { Fx } from '../Fx.js'
import { Handler } from './Handler.js'
import { Pipeable, pipeThis } from './pipe.js'

export interface HandlerContext extends Fx<unknown, unknown> {
  readonly effectId: unknown
  readonly handler: (e: unknown) => Fx<unknown, unknown>
}

export class Scoped<const Name extends string> extends Effect('fx/Scoped')<Name, readonly HandlerContext[]> { }

export const scoped = <const Name extends string>(name: Name): Scoped<Name> =>
  new Scoped(name)

export const handleScoped = <const Name extends string>(name: Name) =>
  <const E, const A>(fx: Fx<E, A>): Fx<E extends Scoped<Name> ? never : E, A> =>
    new ScopedHandler(fx, name) as Fx<E extends Scoped<Name> ? never : E, A>

export const withContext = (c: readonly HandlerContext[], f: Fx<unknown, unknown>) =>
  c.reduce((f, handler) => new Handler(f, handler.effectId, handler.handler), f)

class ScopedHandler<E, A> implements Fx<E, A>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly scopeName: string
  ) { }

  *[Symbol.iterator](): Iterator<E, A> {
    const i = this.fx[Symbol.iterator]()
    try {
      let ir = i.next()

      while (!ir.done) {
        if (isEffect(ir.value)) {
          if (Scoped.is(ir.value) && ir.value.arg === this.scopeName) {
            ir = i.next([])
          } else {
            ir = i.next(yield ir.value as any)
          }
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }
      }

      return ir.value
    } finally {
      i.return?.()
    }
  }
}
