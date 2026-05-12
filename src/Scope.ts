import { Abort } from './Abort.js'
import { isEffect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { Finalizer, Finally } from './Finalization.js'
import { Fx, fx } from './Fx.js'
import { CapturedHandler, HandlerCapture } from './HandlerCapture.js'
import { ReturnFrom } from './ReturnFrom.js'
import { Pipeable, pipeThis } from './internal/pipe.js'

export type Exit<
  Scope extends string = string,
  A = unknown,
  F extends Fail<unknown> = Fail<unknown>,
  R = unknown
> =
  | Success<A>
  | Failure<F>
  | ReturnedFrom<Scope, R>
  | Aborted<Scope>

export interface Success<A> {
  readonly type: 'success'
  readonly value: A
}

export interface Failure<F extends Fail<unknown>> {
  readonly type: 'failure'
  readonly failure: F
}

export interface ReturnedFrom<Scope extends string, A> {
  readonly type: 'returnFrom'
  readonly scope: Scope
  readonly value: A
}

export interface Aborted<Scope extends string> {
  readonly type: 'abort'
  readonly scope: Scope
}

export function scope<const Scope extends string>(
  name: Scope
): <const E, const A>(f: Fx<E, A>) => Fx<ScopeEffects<E, Scope>, A | ReturnValue<E, Scope>> {
  return <const E, const A>(f: Fx<E, A>) =>
    new ScopeBoundary(f, name) as Fx<ScopeEffects<E, Scope>, A | ReturnValue<E, Scope>>
}

export type ScopeEffects<E, Scope extends string> =
  HandleScopeEffect<E, Scope> | CleanupFailure<E, Scope>

type HandleScopeEffect<E, Scope extends string> =
  E extends Finally<Scope> ? never
  : E extends ReturnFrom<Scope, any> ? never
  : E

type CleanupFailure<E, Scope extends string> =
  Extract<E, Finally<Scope>> extends never ? never : Fail<AggregateError>

export type ReturnValue<E, Scope extends string> =
  E extends ReturnFrom<Scope, infer A> ? A : never

class ScopeBoundary<E, A, Scope extends string> implements Fx<unknown, A>, Pipeable, CapturedHandler {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly scopeName: Scope
  ) { }

  wrap(fx: Fx<unknown, unknown>): Fx<unknown, unknown> {
    return new ScopeBoundary(fx, this.scopeName)
  }

  *[Symbol.iterator](): Iterator<unknown, A> {
    const finalizers = [] as Finalizer[]
    const i = this.fx[Symbol.iterator]()
    try {
      let ir = i.next()

      while (!ir.done) {
        if (isEffect(ir.value)) {
          const effect = ir.value

          if (Finally.is(effect) && effect.arg.scope === this.scopeName) {
            finalizers.push(effect.arg.finalizer)
            ir = i.next(undefined)
          } else if (ReturnFrom.is(effect) && effect.arg.scope === this.scopeName) {
            const exit = { type: 'returnFrom', scope: this.scopeName, value: effect.arg.value } satisfies Exit<Scope>
            const failures = yield* releaseSafely(finalizers, exit)
            if (failures.length > 0) return (yield* failCleanup(failures)) as A
            return effect.arg.value as A
          } else if (Abort.is(effect) && effect.arg === this.scopeName) {
            const exit = { type: 'abort', scope: this.scopeName } satisfies Exit<Scope>
            const failures = yield* releaseSafely(finalizers, exit)
            if (failures.length > 0) return (yield* failCleanup(failures)) as A
            return yield effect
          } else if (Fail.is(effect)) {
            const exit = { type: 'failure', failure: effect } satisfies Exit
            const failures = yield* releaseSafely(finalizers, exit)
            if (failures.length > 0) return (yield* failCleanup([effect.arg, ...failures])) as A
            return yield effect
          } else if (HandlerCapture.is(effect)) {
            ir = i.next([this, ...(yield effect) as any])
          } else {
            ir = i.next(yield effect)
          }
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }
      }

      const exit = { type: 'success', value: ir.value } satisfies Exit<Scope, A>
      const failures = yield* releaseSafely(finalizers, exit)
      if (failures.length > 0) return (yield* failCleanup(failures)) as A
      return ir.value
    } finally {
      i.return?.()
    }
  }
}

const releaseSafely = (resources: readonly Finalizer[], exit: Exit) => fx(function* () {
  const failures = [] as unknown[]
  for (let i = resources.length - 1; i >= 0; --i) {
    const r = yield* returnFail(resources[i](exit))
    if (Fail.is(r)) failures.push(r.arg)
  }
  return failures
})

const failCleanup = (failures: readonly unknown[]) =>
  fail(new AggregateError(failures, 'Resource release failed'))
