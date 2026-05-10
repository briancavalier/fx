import { Effect, isEffect } from './Effect.js'
import { Fx, fx, map, ok } from './Fx.js'
import { handle } from './Handler.js'
import type { HandlerContext } from './Scoped.js'
import { Pipeable, pipeThis } from './internal/pipe.js'
import { getRuntimeContext, withActiveRuntimeContext, withRuntimeContext } from './internal/runtimeContext.js'

export class Get<E extends Record<PropertyKey, unknown>> extends Effect('fx/Env')<void, E> { }

export const get = <const E extends Record<PropertyKey, unknown>>() =>
  new Get<E>()

type ExcludeEnv<E, S> =
  E extends Get<Record<PropertyKey, unknown>>
  ? S extends E['R'] ? never
  : S extends Record<PropertyKey, unknown>
  ? Get<{ readonly [K in keyof E['R']as S[K] extends E['R'][K] ? never : K]: E['R'][K] }>
  : E
  : E

export const provide = <const S extends Record<PropertyKey, unknown>>(s: S) => <const E, const A>(f: Fx<E, A>) =>
  f.pipe(
    handle(Get, _ => get().pipe(map(e => ({ ...e, ...s }))))
  ) as Fx<ExcludeEnv<E, S>, A>

export const provideFrom =
  <const PE, const C extends Record<PropertyKey, unknown>>(context: Fx<PE, C>) =>
    <const E, const A>(program: Fx<E, A>) =>
      new LazyProvideFrom(program, context) as Fx<PE | ExcludeEnv<E, C>, A>

export type EnvOf<E> = U2I<EachEnv<E>>
type EachEnv<E> = E extends Get<infer A> ? A : never

export const provideAll = <const S extends Record<PropertyKey, unknown>>(s: S) => <const E, const A>(f: Fx<CheckEnv<S, E>, A>) =>
  f.pipe(
    handle(Get, _ => ok(s))
  ) as Fx<ExcludeEnv<E, S>, A>

type U2I<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never

type CheckEnv<S, E> = E extends Get<infer A> ? S extends A ? E
  : ['provideAll missing required elements', { readonly [K in Exclude<keyof A, keyof S>]: A[K] }]
  : E

class LazyProvideFrom<E, A, PE, C extends Record<PropertyKey, unknown>> implements Fx<PE | ExcludeEnv<E, C>, A>, HandlerContext, Pipeable {
  public readonly effectId = Get._fxEffectId
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    private readonly program: Fx<E, A>,
    private readonly context: Fx<PE, C>
  ) { }

  handler(): Fx<unknown, unknown> {
    return get()
  }

  wrap(program: Fx<unknown, unknown>): Fx<unknown, unknown> {
    return new LazyProvideFrom(program, this.context)
  }

  *[Symbol.iterator](): Iterator<PE | ExcludeEnv<E, C>, A> {
    const { context, program } = this
    const i = program[Symbol.iterator]()
    let hasContext = false
    let provided: C | undefined

    const getProvided = fx(function* () {
      if (!hasContext) {
        provided = yield* context
        hasContext = true
      }

      return provided as C
    })

    try {
      let ir = i.next()

      while (!ir.done) {
        if (isEffect(ir.value)) {
          const effect = ir.value
          if (effect._fxEffectId === this.effectId) {
            const runtimeContext = getRuntimeContext(effect)
            const handled = fx(function* () {
              const c = yield* getProvided
              const e = yield* get()
              return { ...e, ...c }
            })
            const scopedHandled = runtimeContext === undefined
              ? handled
              : withActiveRuntimeContext(runtimeContext, () => handled)
            ir = i.next(yield* withRuntimeContext(runtimeContext, scopedHandled) as any)
          } else if (effect._fxEffectId === 'fx/Scoped') {
            ir = i.next([this, ...(yield effect as any) as any])
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
