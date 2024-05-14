import { EffectType, is, isEffect } from '../Effect'
import { Fork } from '../Fork'
import { Fx } from '../Fx'
import { Pipeable, pipe } from './pipe'

export type Return<E extends EffectType> = InstanceType<E>['R']
export type Arg<E extends EffectType> = InstanceType<E>['arg']

const HandlerTypeId = Symbol('fx/Handler')

export class Handler<E, A> implements Fx<E, A>, Pipeable {
  public readonly _fxTypeId = HandlerTypeId

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly handlers: ReadonlyMap<unknown, (e: unknown) => Fx<unknown, unknown>>,
    public readonly controls: ReadonlyMap<unknown, (resume: (a: any) => unknown, e: unknown) => Fx<unknown, unknown>>
  ) { }

  pipe() { return pipe(this, arguments) }

  *[Symbol.iterator](): Iterator<E, A> {
    let done = true
    const k = (x: any) => {
      done = false
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
              if(done) return hr
              done = true
              ir = i.next(hr)
            } else if (is(Fork, ir.value)) {
              ir = i.next(yield new Fork({ ...ir.value.arg, context: [...ir.value.arg.context, this] }) as any)
            } else {
              ir = i.next(yield ir.value as any)
            }
          }
        }
      }

      return ir.value
    } finally {
      if (i.return) i.return()
    }
  }
}

export const isHandler = (e: unknown): e is Handler<unknown, unknown> =>
  !!e && (e as any)._fxTypeId === HandlerTypeId

export const empty = new Map() as Map<never, never>
