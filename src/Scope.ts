import { Abort } from './Abort.js'
import { isEffect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { Finalizer, Finally } from './Finalization.js'
import { Fx, fx } from './Fx.js'
import { CapturedHandler, HandlerCapture } from './HandlerCapture.js'
import { ReturnFrom } from './ReturnFrom.js'
import { drainIteratorReturn, isInterpretingReturn } from './internal/iteratorClose.js'
import { Pipeable, pipeThis } from './internal/pipe.js'
import { withActiveScope } from './internal/runtimeContext.js'

export const brand = <Brand>() =>
  <const Name extends string>(name: Name): Name & Brand =>
    name as Name & Brand

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
  | Interrupted<Scope>

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

export interface Interrupted<Scope extends string> {
  readonly type: 'interrupted'
  readonly scope: Scope
}

export function scope<const Scope extends string>(
  name: Scope
): <const E, const A>(f: Fx<E, A>) => Fx<ScopeEffects<E, Scope>, A | ReturnValue<E, Scope>> {
  return <const E, const A>(f: Fx<E, A>) =>
    new ScopeBoundary(f, name) as Fx<ScopeEffects<E, Scope>, A | ReturnValue<E, Scope>>
}

export type ScopeEffects<E, Scope extends string> =
  HandleScopeEffect<E, Scope> | CleanupEffects<E, Scope> | CleanupFailure<E, Scope>

type HandleScopeEffect<E, Scope extends string> =
  E extends Finally<Scope, any> ? never
  : E extends ReturnFrom<Scope, any> ? never
  : E

type MatchingFinally<E, Scope extends string> =
  Extract<E, Finally<Scope, any>>

type FinalizerEffects<E, Scope extends string> =
  MatchingFinally<E, Scope> extends never
    ? never
    : MatchingFinally<E, Scope> extends Finally<Scope, infer FE> ? FE : never

type CleanupEffects<E, Scope extends string> =
  Exclude<FinalizerEffects<E, Scope>, Fail<any>>

type CleanupFailure<E, Scope extends string> =
  MatchingFinally<E, Scope> extends never ? never : Fail<AggregateError>

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
    const finalizers = [] as Finalizer<unknown>[]
    const { scopeName } = this
    const i = withActiveScope(scopeName, this.fx)[Symbol.iterator]()
    const captured: CapturedHandler = {
      wrap: fx => new ScopeBoundary(fx, scopeName)
    }
    let released = false
    const release = function* (exit: Exit): Generator<unknown, readonly unknown[]> {
      if (released) return []
      released = true
      return yield* withActiveScope(scopeName, releaseSafely(finalizers, exit))
    }
    const step = function* (ir: IteratorResult<unknown, A>): Generator<unknown, A, unknown> {
      while (!ir.done) {
        if (isEffect(ir.value)) {
          const effect = ir.value
          const sameScope = (effect as { readonly scope?: unknown }).scope === scopeName

          if (sameScope && Finally.is(effect)) {
            finalizers.push(effect.arg)
            ir = i.next(undefined)
          } else if (sameScope && ReturnFrom.is(effect)) {
            const exit = { type: 'returnFrom', scope: scopeName, value: effect.arg } satisfies Exit<Scope>
            const failures = yield* release(exit)
            if (failures.length > 0) return (yield* withActiveScope(scopeName, failCleanup(failures))) as A
            return effect.arg as A
          } else if (sameScope && Abort.is(effect)) {
            const exit = { type: 'abort', scope: scopeName } satisfies Exit<Scope>
            const failures = yield* release(exit)
            if (failures.length > 0) return (yield* withActiveScope(scopeName, failCleanup(failures))) as A
            return (yield effect) as A
          } else if (Fail.is(effect)) {
            const exit = { type: 'failure', failure: effect } satisfies Exit
            const failures = yield* release(exit)
            if (failures.length > 0) return (yield* withActiveScope(scopeName, failCleanup([effect.arg, ...failures]))) as A
            return (yield effect) as A
          } else if (HandlerCapture.is(effect)) {
            ir = i.next([captured, ...(yield effect) as any])
          } else {
            ir = i.next(yield effect)
          }
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }
      }

      const exit = { type: 'success', value: ir.value } satisfies Exit<Scope, A>
      const failures = yield* release(exit)
      if (failures.length > 0) return (yield* withActiveScope(scopeName, failCleanup(failures))) as A
      return ir.value
    }

    let completed = false
    try {
      const value = yield* step(i.next())
      completed = true
      return value
    } finally {
      const cleanupFailures = yield* collectInterruptedCleanupFailures(scopeName, release, completed, isInterpretingReturn(), i, step)
      if (cleanupFailures.length > 0) yield* withActiveScope(scopeName, failCleanup(cleanupFailures))
    }
  }
}

const collectInterruptedCleanupFailures = function* <A, Scope extends string>(
  scopeName: Scope,
  release: (exit: Exit) => Generator<unknown, readonly unknown[]>,
  completed: boolean,
  shouldDrainReturn: boolean,
  iterator: Iterator<unknown, A, unknown>,
  step: (ir: IteratorResult<unknown, A>) => Generator<unknown, A, unknown>
): Generator<unknown, readonly unknown[], unknown> {
  const failures = [] as unknown[]
  const exit = { type: 'interrupted', scope: scopeName } satisfies Exit<Scope>

  yield* collectCleanupFailures(failures, function* () {
    failures.push(...yield* release(exit))
  })

  if (!completed && shouldDrainReturn) {
    yield* collectCleanupFailures(failures, function* () {
      const result = yield* returnFail(fx(function* () {
        return yield* drainIteratorReturn(iterator, step)
      }))
      if (Fail.is(result)) failures.push(result.arg)
    })
  }

  return failures
}

const collectCleanupFailures = function* (
  failures: unknown[],
  cleanup: () => Generator<unknown, void, unknown>
): Generator<unknown, void, unknown> {
  try {
    yield* cleanup()
  } catch (e) {
    failures.push(e)
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

const failCleanup = (failures: readonly unknown[]) => fx(function* () {
  return yield* fail(new AggregateError(failures, 'Resource release failed'))
})
