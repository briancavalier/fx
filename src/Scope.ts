import { Abort } from './Abort.js'
import { isEffect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { Finalizer, Finally } from './Finalization.js'
import { Fx, fx } from './Fx.js'
import { CapturedHandler, HandlerCapture } from './HandlerCapture.js'
import { InterruptFrom } from './InterruptFrom.js'
import { ReturnFrom } from './ReturnFrom.js'
import { drainIteratorReturn, isInterpretingReturn } from './internal/iteratorClose.js'
import { Pipeable, pipeThis } from './internal/pipe.js'
import { interruptionReason, withActiveScope, type ActiveScopeDiagnostic } from './internal/runtimeContext.js'
import { ScopeTypeId, sameScope, type ScopeIdentity } from './internal/scopeIdentity.js'

export { ScopeTypeId, sameScope }

export interface ScopeMetadata {
  readonly label?: string
  readonly description?: string
}

export interface Scope<Name extends string = string> extends ScopeIdentity<Name> {
  readonly name: Name
  readonly label?: string
  readonly description?: string
}

export type AnyScope = Scope<string>

export function scope<Brand>(): <const Name extends string>(name: Name, metadata?: ScopeMetadata) => Scope<Name> & Brand
export function scope<const Name extends string>(name: Name, metadata?: ScopeMetadata): Scope<Name>
export function scope(name?: string, metadata: ScopeMetadata = {}) {
  if (name === undefined) return scope

  const token = {
    ...metadata,
    name
  }

  Object.defineProperty(token, ScopeTypeId, {
    value: name,
    enumerable: false,
    writable: false,
    configurable: false
  })

  return token
}

export const scopeLabel = (scope: AnyScope): string =>
  scope.label ?? scope.name

const scopeDiagnostic = (scope: AnyScope): ActiveScopeDiagnostic => {
  const diagnostic = {
    label: scopeLabel(scope),
    ...(scope.description === undefined ? {} : { description: scope.description })
  }

  Object.defineProperty(diagnostic, ScopeTypeId, {
    value: scope[ScopeTypeId],
    enumerable: false,
    writable: false,
    configurable: false
  })

  return diagnostic as ActiveScopeDiagnostic
}

export type Exit<
  Scope extends AnyScope = AnyScope,
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

export interface ReturnedFrom<Scope extends AnyScope, A> {
  readonly type: 'returnFrom'
  readonly scope: Scope
  readonly value: A
}

export interface Aborted<Scope extends AnyScope> {
  readonly type: 'abort'
  readonly scope: Scope
}

export interface Interrupted<Scope extends AnyScope> {
  readonly type: 'interrupted'
  readonly scope: Scope
  readonly reason?: unknown
}

export function withScope<const Scope extends AnyScope>(
  scope: Scope
): <const E, const A>(f: Fx<E, A>) => Fx<ScopeEffects<E, Scope>, A | ReturnValue<E, Scope>> {
  return <const E, const A>(f: Fx<E, A>) =>
    new ScopeBoundary(f, scope) as Fx<ScopeEffects<E, Scope>, A | ReturnValue<E, Scope>>
}

export type ScopeEffects<E, Scope extends AnyScope> =
  HandleScopeEffect<E, Scope> | CleanupEffects<E, Scope> | CleanupFailure<E, Scope>

type HandleScopeEffect<E, Scope extends AnyScope> =
  E extends Finally<Scope, any> ? never
  : E extends ReturnFrom<Scope, any> ? never
  : E

type MatchingFinally<E, Scope extends AnyScope> =
  Extract<E, Finally<Scope, any>>

type FinalizerEffects<E, Scope extends AnyScope> =
  MatchingFinally<E, Scope> extends never
    ? never
    : MatchingFinally<E, Scope> extends Finally<Scope, infer FE> ? FE : never

type CleanupEffects<E, Scope extends AnyScope> =
  Exclude<FinalizerEffects<E, Scope>, Fail<any>>

type CleanupFailure<E, Scope extends AnyScope> =
  MatchingFinally<E, Scope> extends never ? never : Fail<AggregateError>

export type ReturnValue<E, Scope extends AnyScope> =
  E extends ReturnFrom<Scope, infer A> ? A : never

class ScopeBoundary<E, A, Scope extends AnyScope> implements Fx<unknown, A>, Pipeable, CapturedHandler {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly scope: Scope
  ) { }

  wrap(fx: Fx<unknown, unknown>): Fx<unknown, unknown> {
    return new ScopeBoundary(fx, this.scope)
  }

  *[Symbol.iterator](): Iterator<unknown, A> {
    const finalizers = [] as Finalizer<unknown>[]
    const { scope } = this
    const activeScope = scopeDiagnostic(scope)
    const i = withActiveScope(activeScope, this.fx)[Symbol.iterator]()
    const captured: CapturedHandler = {
      wrap: fx => new ScopeBoundary(fx, scope)
    }
    let released = false
    const release = function* (exit: Exit): Generator<unknown, readonly unknown[]> {
      if (released) return []
      released = true
      return yield* withActiveScope(activeScope, releaseSafely(finalizers, exit))
    }
    const step = function* (ir: IteratorResult<unknown, A>): Generator<unknown, A, unknown> {
      while (!ir.done) {
        if (isEffect(ir.value)) {
          const effect = ir.value
          const effectScope = (effect as { readonly scope?: AnyScope }).scope
          const matchesScope = effectScope !== undefined && sameScope(effectScope, scope)

          if (matchesScope && Finally.is(effect)) {
            finalizers.push(effect.arg)
            ir = i.next(undefined)
          } else if (matchesScope && ReturnFrom.is(effect)) {
            const exit = { type: 'returnFrom', scope, value: effect.arg } satisfies Exit<Scope>
            const failures = yield* release(exit)
            if (failures.length > 0) return (yield* withActiveScope(activeScope, failCleanup(failures))) as A
            return effect.arg as A
          } else if (matchesScope && Abort.is(effect)) {
            const exit = { type: 'abort', scope } satisfies Exit<Scope>
            const failures = yield* release(exit)
            if (failures.length > 0) return (yield* withActiveScope(activeScope, failCleanup(failures))) as A
            return (yield effect) as A
          } else if (matchesScope && InterruptFrom.is(effect)) {
            const exit = interruptedExit(scope, effect.arg)
            const failures = yield* release(exit)
            if (failures.length > 0) return (yield* withActiveScope(activeScope, failCleanup(failures))) as A
            return (yield effect) as A
          } else if (Fail.is(effect)) {
            const exit = { type: 'failure', failure: effect } satisfies Exit
            const failures = yield* release(exit)
            if (failures.length > 0) return (yield* withActiveScope(activeScope, failCleanup([effect.arg, ...failures]))) as A
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
      if (failures.length > 0) return (yield* withActiveScope(activeScope, failCleanup(failures))) as A
      return ir.value
    }

    let completed = false
    try {
      const value = yield* step(i.next())
      completed = true
      return value
    } finally {
      const cleanupFailures = yield* collectInterruptedCleanupFailures(scope, release, completed, isInterpretingReturn(), i, step)
      if (cleanupFailures.length > 0) yield* withActiveScope(activeScope, failCleanup(cleanupFailures))
    }
  }
}

const collectInterruptedCleanupFailures = function* <A, Scope extends AnyScope>(
  scope: Scope,
  release: (exit: Exit) => Generator<unknown, readonly unknown[]>,
  completed: boolean,
  shouldDrainReturn: boolean,
  iterator: Iterator<unknown, A, unknown>,
  step: (ir: IteratorResult<unknown, A>) => Generator<unknown, A, unknown>
): Generator<unknown, readonly unknown[], unknown> {
  const failures = [] as unknown[]
  const exit = interruptedExit(scope, interruptionReason())

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

const interruptedExit = <Scope extends AnyScope>(scope: Scope, reason: unknown): Exit<Scope> =>
  reason === undefined
    ? { type: 'interrupted', scope }
    : { type: 'interrupted', scope, reason }

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
