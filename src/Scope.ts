import { Async, assertPromise } from './Async.js'
import { Abort } from './Abort.js'
import { isEffect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { Finalizer, Finally } from './Finalization.js'
import { Fx, fx, ok } from './Fx.js'
import { CapturedHandler, HandlerCapture } from './HandlerCapture.js'
import { InterruptFrom } from './InterruptFrom.js'
import { ReturnFrom } from './ReturnFrom.js'
import { Fork } from './internal/concurrent/effects.js'
import { drainIteratorReturn, isInterpretingReturn, isInterruptedReturn } from './internal/iteratorClose.js'
import { Pipeable, pipeThis } from './internal/pipe.js'
import { interruptionReason, withActiveScope, type ActiveScopeDiagnostic } from './internal/runtimeContext.js'
import { ScopeTypeId, sameScope, scopeId, type ScopeIdentity } from './internal/scopeIdentity.js'
import { ScopedFork } from './internal/scopedFork.js'
import type { ScopedForkContext } from './internal/scopedFork.js'
import type { Task } from './Task.js'

export { sameScope, scopeId }

export interface ScopeMetadata {
  readonly label?: string
  readonly diagnostic?: boolean
}

export interface Scope<Id extends PropertyKey = PropertyKey> extends ScopeIdentity<Id> {
  readonly label?: string
  readonly diagnostic?: boolean
}

export type AnyScope = Scope<PropertyKey>

export function scope<Brand>(): <const Id extends PropertyKey>(id: Id, metadata?: ScopeMetadata) => Scope<Id> & Brand
export function scope<const Id extends PropertyKey>(id: Id, metadata?: ScopeMetadata): Scope<Id>
export function scope(id?: PropertyKey, metadata: ScopeMetadata = {}): any {
  if (id === undefined) return scope
  const token = { ...metadata }
  Object.defineProperty(token, ScopeTypeId, {
    value: id,
    enumerable: false,
    writable: false,
    configurable: false
  })
  return token
}

export const scopeLabel = (scope: AnyScope): string =>
  scope.label ?? String(scopeId(scope))

const scopeDiagnostic = (scope: AnyScope): ActiveScopeDiagnostic => {
  return {
    id: scopeId(scope),
    label: scopeLabel(scope)
  }
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
  HandleScopeEffect<E, Scope> | ScopedForkEffects<E, Scope> | CleanupEffects<E, Scope> | CleanupFailure<E, Scope>

type HandleScopeEffect<E, Scope extends AnyScope> =
  E extends Finally<Scope, any> ? never
  : E extends ReturnFrom<Scope, any> ? never
  : E extends ScopedFork<Scope> ? never
  : E

type ScopedForkEffects<E, Scope extends AnyScope> =
  E extends ScopedFork<Scope> ? Fork | Async | Fail<unknown> : never

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

  private readonly controller?: ScopeController<Scope>
  private readonly root: boolean

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly scope: Scope,
    controller?: ScopeController<Scope>
  ) {
    this.controller = controller
    this.root = controller === undefined
  }

  wrap(fx: Fx<unknown, unknown>): Fx<unknown, unknown> {
    return new ScopeBoundary(fx, this.scope)
  }

  wrapShared(fx: Fx<unknown, unknown>): Fx<unknown, unknown> {
    return this.controller === undefined
      ? new ScopeBoundary(fx, this.scope)
      : new ScopeBoundary(fx, this.scope, this.controller)
  }

  *[Symbol.iterator](): Iterator<unknown, A> {
    const { scope } = this
    const controller = this.controller ?? new ScopeController(scope)
    const root = this.root
    const activeScope = root && scope.diagnostic !== false ? scopeDiagnostic(scope) : undefined
    const withMaybeActiveScope = <E, A>(fx: Fx<E, A>): Fx<E, A> =>
      activeScope === undefined ? fx : withActiveScope(activeScope, fx)
    const i = withMaybeActiveScope(this.fx)[Symbol.iterator]()
    const captured: CapturedHandler = {
      wrap: fx => new ScopeBoundary(fx, scope)
    }
    const capturedShared: CapturedHandler = {
      wrap: fx => new ScopeBoundary(fx, scope, controller)
    }
    let released = false
    const release = function* (exit: Exit<Scope>): Generator<unknown, ScopeRelease<Scope>> {
      if (released) return { exit, failures: [] }
      released = true
      const { exit: finalExit, failures: taskFailures } = yield* withMaybeActiveScope(controller.join(exit))
      const finalizerFailures = yield* withMaybeActiveScope(releaseSafely(controller.finalizers, finalExit))
      return { exit: finalExit, failures: [...taskFailures, ...finalizerFailures] }
    }
    const step = function* (ir: IteratorResult<unknown, A>): Generator<unknown, A, unknown> {
      while (!ir.done) {
        if (isEffect(ir.value)) {
          const effect = ir.value
          const effectScope = (effect as { readonly scope?: AnyScope }).scope
          const matchesScope = effectScope !== undefined && sameScope(effectScope, scope)

          if (matchesScope && Finally.is(effect)) {
            controller.addFinalizer(effect.arg)
            ir = i.next(undefined)
          } else if (matchesScope && ScopedFork.is(effect)) {
            const task = yield* controller.fork(effect.arg)
            ir = i.next(task)
          } else if (matchesScope && ReturnFrom.is(effect)) {
            const exit = { type: 'returnFrom', scope, value: effect.arg } satisfies Exit<Scope>
            if (!root) {
              controller.requestExit(exit)
              return effect.arg as A
            }
            const { failures } = yield* release(exit)
            const cleanupFailures = failures.flatMap(cleanupFailuresOf)
            if (cleanupFailures.length > 0) return (yield* withMaybeActiveScope(failCleanup(cleanupFailures))) as A
            return effect.arg as A
          } else if (matchesScope && Abort.is(effect)) {
            const exit = { type: 'abort', scope } satisfies Exit<Scope>
            if (!root) {
              controller.requestExit(exit)
              return undefined as A
            }
            const { failures } = yield* release(exit)
            const cleanupFailures = failures.flatMap(cleanupFailuresOf)
            if (cleanupFailures.length > 0) return (yield* withMaybeActiveScope(failCleanup(cleanupFailures))) as A
            return (yield effect) as A
          } else if (matchesScope && InterruptFrom.is(effect)) {
            const exit = interruptedExit(scope, effect.arg)
            if (!root) {
              controller.requestExit(exit)
              return undefined as A
            }
            const { failures } = yield* release(exit)
            const cleanupFailures = failures.flatMap(cleanupFailuresOf)
            if (cleanupFailures.length > 0) return (yield* withMaybeActiveScope(failCleanup(cleanupFailures))) as A
            return (yield effect) as A
          } else if (Fail.is(effect)) {
            const exit = { type: 'failure', failure: effect } satisfies Exit
            if (!root) {
              return (yield effect) as A
            }
            const { failures } = yield* release(exit)
            const cleanupFailures = failures.flatMap(cleanupFailuresOf)
            if (cleanupFailures.length > 0) return (yield* withMaybeActiveScope(failCleanup([effect.arg, ...cleanupFailures]))) as A
            return (yield effect) as A
          } else if (HandlerCapture.is(effect)) {
            const local = effect.arg === 'fx/Concurrent/ForkIn' ? capturedShared : captured
            ir = i.next([local, ...(yield effect) as any])
          } else {
            ir = i.next(yield effect)
          }
        } else {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }
      }

      const exit = { type: 'success', value: ir.value } satisfies Exit<Scope, A>
      if (!root) return ir.value
      const result = yield* release(exit)
      if (result.exit.type === 'failure') {
        const cleanupFailures = result.failures.flatMap(cleanupFailuresOf)
        if (cleanupFailures.length > 0) return (yield* withMaybeActiveScope(failCleanup([result.exit.failure.arg, ...cleanupFailures]))) as A
        return (yield result.exit.failure) as A
      }
      const cleanupFailures = result.failures.flatMap(cleanupFailuresOf)
      if (cleanupFailures.length > 0) return (yield* withMaybeActiveScope(failCleanup(cleanupFailures))) as A
      if (result.exit.type === 'returnFrom') return result.exit.value as A
      if (result.exit.type === 'abort') return (yield new Abort(result.exit.scope, undefined)) as A
      if (result.exit.type === 'interrupted') return (yield new InterruptFrom(result.exit.scope, result.exit.reason)) as A
      return ir.value
    }

    let completed = false
    try {
      const value = yield* step(i.next())
      completed = true
      return value
    } finally {
      const cleanupFailures = root
        ? yield* collectInterruptedCleanupFailures(scope, release, completed, isInterpretingReturn(), i, step)
        : yield* collectInterruptedChildCleanupFailures(completed, isInterpretingReturn(), i, step)
      const filteredCleanupFailures = cleanupFailures.flatMap(cleanupFailuresOf)
      if (filteredCleanupFailures.length > 0) yield* withMaybeActiveScope(failCleanup(filteredCleanupFailures))
    }
  }
}

class ScopeController<Scope extends AnyScope> {
  readonly finalizers = [] as Finalizer<unknown>[]
  private readonly tasks = new Map<Task<unknown, unknown>, ScopedForkContext>()
  private settled?: Exit<Scope>

  constructor(readonly scope: Scope) { }

  get exit() {
    return this.settled
  }

  addFinalizer(finalizer: Finalizer<unknown>) {
    this.finalizers.push(finalizer)
  }

  *fork(context: ScopedForkContext): Generator<unknown, Task<unknown, unknown>, unknown> {
    const task = (yield new Fork(context)) as Task<unknown, unknown>
    task._markHandled()
    this.tasks.set(task, context)
    return task
  }

  requestExit(exit: Exit<Scope>) {
    this.settled ??= exit
  }

  join(exit: Exit<Scope>): Fx<Async, { readonly exit: Exit<Scope>, readonly failures: readonly unknown[] }> {
    if (exit.type !== 'success') this.requestExit(exit)
    if (this.tasks.size === 0) return ok({ exit: this.settled ?? exit, failures: [] })
    return assertPromise(() => this.joinTasks(exit))
  }

  private async joinTasks(initialExit: Exit<Scope>): Promise<{ readonly exit: Exit<Scope>, readonly failures: readonly unknown[] }> {
    const failures = [] as unknown[]
    const pending = new Set(this.tasks.keys())

    while (pending.size > 0) {
      const exit = this.settled
      if (exit !== undefined && exit.type !== 'success') break
      if (initialExit.type === 'success' && !hasKeepAlive(pending, this.tasks)) break

      const result = await Promise.race([...pending].map(task =>
        task.promise.then(
          value => ({ task, status: 'fulfilled' as const, value }),
          reason => ({ task, status: 'rejected' as const, reason })
        )
      ))
      pending.delete(result.task)

      if (result.status === 'rejected') {
        this.settled = { type: 'failure', failure: new Fail(result.reason) }
        break
      }
    }

    const exit = this.settled ?? initialExit
    if (pending.size > 0 || exit.type !== 'success') {
      failures.push(...await this.interruptPending(pending, interruptReason(exit)))
    }

    return { exit, failures }
  }

  private async interruptPending(tasks: Iterable<Task<unknown, unknown>>, reason?: unknown): Promise<readonly unknown[]> {
    const results = await Promise.allSettled([...tasks].map(task => task.interrupt(reason)))
    return results.flatMap(result =>
      result.status === 'rejected' ? cleanupFailuresOf(result.reason) : []
    )
  }
}

const hasKeepAlive = (
  pending: Iterable<Task<unknown, unknown>>,
  tasks: Map<Task<unknown, unknown>, ScopedForkContext>
) => {
  for (const task of pending) {
    if (tasks.get(task)?.keepAlive !== false) return true
  }
  return false
}

interface ScopeRelease<Scope extends AnyScope> {
  readonly exit: Exit<Scope>
  readonly failures: readonly unknown[]
}

const collectInterruptedCleanupFailures = function* <A, Scope extends AnyScope>(
  scope: Scope,
  release: (exit: Exit<Scope>) => Generator<unknown, ScopeRelease<Scope>>,
  completed: boolean,
  shouldDrainReturn: boolean,
  iterator: Iterator<unknown, A, unknown>,
  step: (ir: IteratorResult<unknown, A>) => Generator<unknown, A, unknown>
): Generator<unknown, readonly unknown[], unknown> {
  const failures = [] as unknown[]
  const exit = interruptedExit(scope, interruptionReason())

  yield* collectCleanupFailures(failures, function* () {
    failures.push(...(yield* release(exit)).failures)
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

const collectInterruptedChildCleanupFailures = function* <A>(
  completed: boolean,
  shouldDrainReturn: boolean,
  iterator: Iterator<unknown, A, unknown>,
  step: (ir: IteratorResult<unknown, A>) => Generator<unknown, A, unknown>
): Generator<unknown, readonly unknown[], unknown> {
  const failures = [] as unknown[]

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
    try {
      const r = yield* returnFail(resources[i](exit))
      if (Fail.is(r)) failures.push(r.arg)
    } catch (e) {
      failures.push(e)
    }
  }
  return failures
})

const failCleanup = (failures: readonly unknown[]) => fx(function* () {
  return yield* fail(new AggregateError(failures.flatMap(cleanupFailuresOf), 'Resource release failed'))
})

const interruptReason = (exit: Exit): unknown =>
  exit.type === 'interrupted' ? exit.reason : undefined

const cleanupFailuresOf = (failure: unknown): readonly unknown[] => {
  const cleanupFailure = isResourceReleaseFailure(failure)
    ? failure
    : typeof failure === 'object' && failure !== null && 'cause' in failure && isResourceReleaseFailure(failure.cause)
    ? failure.cause
    : undefined

  if (cleanupFailure === undefined && (isInterruptedReturn(failure) || isInterruptedUndefinedResumeFailure(failure))) return []

  return cleanupFailure === undefined
    ? [failure]
    : cleanupFailure.errors.flatMap(cleanupFailuresOf)
}

const isResourceReleaseFailure = (failure: unknown): failure is AggregateError =>
  failure instanceof AggregateError && failure.message === 'Resource release failed'
  || typeof failure === 'object' && failure !== null
    && 'message' in failure && failure.message === 'Resource release failed'
    && 'errors' in failure && Array.isArray(failure.errors)

const isInterruptedUndefinedResumeFailure = (failure: unknown): boolean =>
  failure instanceof TypeError && failure.message.startsWith('Cannot read properties of undefined ')
