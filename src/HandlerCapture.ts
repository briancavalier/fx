import { Effect, EffectType, isEffect } from './Effect.js'
import { Fx, map } from './Fx.js'
import { Answer, Handler } from './internal/Handler.js'
import { Pipeable, pipeThis } from './internal/pipe.js'

export interface CapturedHandler {
  wrap(fx: Fx<unknown, unknown>): Fx<unknown, unknown>
}

export class HandlerCapture<const Name extends string> extends Effect('fx/HandlerCapture')<Name, readonly CapturedHandler[]> { }

export const captureHandlers = <const Name extends string>(name: Name): HandlerCapture<Name> =>
  new HandlerCapture(name)

export const withCapturedHandlers = <const Name extends string, const E, const A>(
  name: Name,
  fx: Fx<E, A>
): Fx<HandlerCapture<Name>, Fx<unknown, A>> =>
  captureHandlers(name).pipe(
    map(context => withHandlerContext(context, fx) as Fx<unknown, A>)
  )

export const mapCapturedHandlers = <const Name extends string, const Fxs extends readonly Fx<unknown, unknown>[]>(
  name: Name,
  fxs: Fxs
): Fx<HandlerCapture<Name>, CapturedHandlerFxs<Fxs>> =>
  captureHandlers(name).pipe(
    map(context =>
      fxs.map(fx => withHandlerContext(context, fx)) as unknown as CapturedHandlerFxs<Fxs>
    )
  )

export const closeHandlerCapture = <const Name extends string>(name: Name) =>
  <const E, const A>(fx: Fx<E, A>): Fx<E extends HandlerCapture<Name> ? never : E, A> =>
    new HandlerCaptureBoundary(fx, name) as Fx<E extends HandlerCapture<Name> ? never : E, A>

export const handleCaptured = <const Name extends string, T extends EffectType, HandlerEffects>(
  name: Name,
  e: T,
  f: (effect: InstanceType<T>) => Fx<HandlerEffects, Answer<T>>
) => <const E, const A>(
  fx: Fx<E, A>
): Fx<Handle<Handle<E, InstanceType<T>, HandlerEffects>, HandlerCapture<Name>>, A> =>
    new HandlerCaptureBoundary(
      new Handler(fx, e._fxEffectId, f) as Fx<Handle<E, InstanceType<T>, HandlerEffects>, A>,
      name
    ) as Fx<Handle<Handle<E, InstanceType<T>, HandlerEffects>, HandlerCapture<Name>>, A>

export const withHandlerContext = (c: readonly CapturedHandler[], f: Fx<unknown, unknown>) =>
  c.reduce((f, handler) => handler.wrap(f), f)

type Handle<E, A, B = never> = E extends A ? B : E
type CapturedHandlerFxs<Fxs extends readonly Fx<unknown, unknown>[]> = {
  readonly [K in keyof Fxs]: Fxs[K] extends Fx<unknown, infer A> ? Fx<unknown, A> : never
}

class HandlerCaptureBoundary<E, A> implements Fx<E, A>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly captureName: string
  ) { }

  *[Symbol.iterator](): Iterator<E, A> {
    const i = this.fx[Symbol.iterator]()
    try {
      let ir = i.next()

      while (!ir.done) {
        if (isEffect(ir.value)) {
          if (HandlerCapture.is(ir.value) && ir.value.arg === this.captureName) {
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
