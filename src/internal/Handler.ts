import { EffectType, isEffect } from '../Effect'
import { Fx } from '../Fx'
import { GetHandlerContext, HandlerContext } from './HandlerContext'
import { Pipeable, pipeThis } from './pipe'

export type Answer<E extends EffectType> = InstanceType<E>['R']
export type Arg<E extends EffectType> = InstanceType<E>['arg']

export class Handler<E, A> implements Fx<E, A>, Pipeable, HandlerContext {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly effectId: unknown,
    public readonly handler: (e: unknown) => Fx<unknown, unknown>
  ) { }

  *[Symbol.iterator](): Iterator<E, A> {
    const { effectId, handler, fx } = this
    const i = fx[Symbol.iterator]()
    try {
      let ir = i.next()

      while (!ir.done) {
        if (isEffect(ir.value)) {
          if (effectId === ir.value._fxEffectId) {
            ir = i.next(yield* handler(ir.value.arg) as any)
          } else if (GetHandlerContext.is(ir.value)) {
            ir = i.next([this, ...(yield ir.value) as any])
          } else {
            ir = i.next(yield ir.value as any)
          }
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${ir.value}`)
        }
      }

      return ir.value
    } finally {
      i.return?.()
    }
  }
}

export class Control<E, A> implements Fx<E, A>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly effectId: unknown,
    public readonly handler: (resume: (a: any) => unknown, e: unknown) => Fx<unknown, unknown>
  ) { }

  *[Symbol.iterator](): Iterator<E, A> {
    let done = false
    const k = (x: any) => {
      if (done) throw new Error('Handler resumed more than once')
      done = true
      return x
    }

    const { effectId, handler, fx } = this
    const i = fx[Symbol.iterator]()
    try {
      let ir = i.next()

      while (!ir.done) {
        if (isEffect(ir.value)) {
          if (effectId === ir.value._fxEffectId) {
            const hr = yield* handler(k, ir.value.arg) as any
            if (!done) return hr
            done = false
            ir = i.next(hr)
          } else {
            ir = i.next(yield ir.value as any)
          }
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${ir.value}`)
        }
      }

      return ir.value
    } finally {
      i.return?.()
    }
  }
}
