import { EffectType, isEffect } from '../Effect.js'
import { Fx } from '../Fx.js'
import type { HandlerContext } from '../Scoped.js'
import { Pipeable, pipeThis } from './pipe.js'
import { getRuntimeContext, withActiveRuntimeContext, withRuntimeContext } from './runtimeContext.js'

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
          const effect = ir.value
          if (effectId === effect._fxEffectId) {
            const context = getRuntimeContext(effect)
            const handled = context === undefined
              ? handler(effect.arg)
              : withActiveRuntimeContext(context, () => handler(effect.arg))
            ir = i.next(yield* withRuntimeContext(context, handled) as any)
          } else if (effect._fxEffectId === 'fx/Scoped') {
            ir = i.next([this, ...(yield effect) as any])
          } else {
            ir = i.next(yield effect as any)
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
          const effect = ir.value
          if (effectId === effect._fxEffectId) {
            const context = getRuntimeContext(effect)
            const handled = context === undefined
              ? handler(k, effect.arg)
              : withActiveRuntimeContext(context, () => handler(k, effect.arg))
            const hr = yield* withRuntimeContext(context, handled) as any
            if (!done) return hr
            done = false
            ir = i.next(hr)
          } else {
            ir = i.next(yield effect as any)
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
