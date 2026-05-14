import { EffectType, isEffect } from '../Effect.js'
import { Fx } from '../Fx.js'
import { HandlerCapture, type CapturedHandler } from '../HandlerCapture.js'
import { drainIteratorReturn } from './iteratorClose.js'
import { Pipeable, pipeThis } from './pipe.js'
import { getRuntimeContext, withActiveRuntimeContext, withRuntimeContext } from './runtimeContext.js'

export type Answer<E extends EffectType> = InstanceType<E>['R']
export type Arg<E extends EffectType> = InstanceType<E>['arg']

export class Handler<E, A> implements Fx<E, A>, Pipeable, CapturedHandler {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly effectId: unknown,
    public readonly handler: (effect: any) => Fx<unknown, unknown>
  ) { }

  wrap(fx: Fx<unknown, unknown>): Fx<unknown, unknown> {
    return new Handler(fx, this.effectId, this.handler)
  }

  *[Symbol.iterator](): Iterator<E, A> {
    const { effectId, handler, fx } = this
    const i = fx[Symbol.iterator]()
    const captured: CapturedHandler = {
      wrap: fx => new Handler(fx, effectId, handler)
    }
    const step = function* (ir: IteratorResult<E, A>): Generator<E, A, unknown> {
      while (!ir.done) {
        if (isEffect(ir.value)) {
          const effect = ir.value
          if (effectId === effect._fxEffectId) {
            const context = getRuntimeContext(effect)
            const handled = context === undefined
              ? handler(effect)
              : withActiveRuntimeContext(context, () => handler(effect))
            ir = i.next(yield* withRuntimeContext(context, handled) as any)
          } else if (HandlerCapture.is(effect)) {
            ir = i.next([captured, ...(yield effect) as any])
          } else {
            ir = i.next(yield effect as any)
          }
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }
      }

      return ir.value
    }
    let completed = false
    try {
      const value = yield* step(i.next())
      completed = true
      return value
    } finally {
      if (!completed) {
        yield* drainIteratorReturn(i, step)
      }
    }
  }
}

export class Control<E, A> implements Fx<E, A>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly effectId: unknown,
    public readonly handler: (resume: (a: any) => unknown, effect: any) => Fx<unknown, unknown>
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
    const step = function* (ir: IteratorResult<E, A>): Generator<E, A, unknown> {
      while (!ir.done) {
        if (isEffect(ir.value)) {
          const effect = ir.value
          if (effectId === effect._fxEffectId) {
            const context = getRuntimeContext(effect)
            const handled = context === undefined
              ? handler(k, effect)
              : withActiveRuntimeContext(context, () => handler(k, effect))
            const hr = yield* withRuntimeContext(context, handled) as any
            if (!done) {
              yield* drainIteratorReturn(i, step)
              return hr
            }
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
    }
    let completed = false
    try {
      const value = yield* step(i.next())
      completed = true
      return value
    } finally {
      if (!completed) {
        yield* drainIteratorReturn(i, step)
      }
    }
  }
}
