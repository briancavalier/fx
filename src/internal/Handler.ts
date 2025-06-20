import { EffectType, isEffect } from '../Effect'
import { Fx } from '../Fx'
import { GetHandlerContext, HandlerContext } from './HandlerContext'
import { Pipeable, pipeThis } from './pipe'

export type Answer<E extends EffectType> = InstanceType<E>['R']
export type Arg<E extends EffectType> = InstanceType<E>['arg']

const HandlerTypeId = Symbol('fx/Handler')

export class Handler<E, A> implements Fx<E, A>, Pipeable, HandlerContext {
  public readonly _fxTypeId = HandlerTypeId
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly handlers: ReadonlyMap<unknown, (e: unknown) => Fx<unknown, unknown>>,
    public readonly controls: ReadonlyMap<unknown, (resume: (a: any) => unknown, e: unknown) => Fx<unknown, unknown>>
  ) { }

  *[Symbol.iterator](): Iterator<E, A> {
    let done = false
    const k = (x: any) => {
      if (done) throw new Error('Handler resumed more than once')
      done = true
      return x
    }

    const { handlers, controls, fx } = this
    const i = fx[Symbol.iterator]()
    try {
      let ir = i.next()

      while (!ir.done) {
        if (isEffect(ir.value)) {
          const handle = handlers.get(ir.value._fxEffectId)
          if (handle) {
            ir = i.next(yield* handle(ir.value.arg) as any)
          } else {
            const control = controls.get(ir.value._fxEffectId)
            if (control) {
              const hr = yield* control(k, ir.value.arg) as any
              if (!done) return hr
              done = false
              ir = i.next(hr)
            } else if (GetHandlerContext.is(ir.value)) {
              ir = i.next([this, ...(yield ir.value) as any])
            } else {
              ir = i.next(yield ir.value as any)
            }
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

export const isHandler = (e: unknown): e is Handler<unknown, unknown> =>
  !!e && (e as any)._fxTypeId === HandlerTypeId

export const empty = new Map() as Map<never, never>
