import { Async } from './Async.js'
import { at } from './Breadcrumb.js'
import { Abort } from './Abort.js'
import { isEffect, type AnyEffect } from './Effect.js'
import { Fail, fail, returnFail } from './Fail.js'
import { Finalizer, Finally } from './Finalization.js'
import { Fx, fx, ok } from './Fx.js'
import { CapturedHandler, HandlerCapture, withHandlerContext } from './HandlerCapture.js'
import { InterruptFrom } from './InterruptFrom.js'
import { ReturnFrom } from './ReturnFrom.js'
import { Fork } from './internal/concurrent/effects.js'
import { cooperativeAssertPromise } from './internal/concurrent/cooperativeAsync.js'
import { drainExitRegionReturn, isExitRegionSuccess, type CapturedExit, type ExitRegionStep } from './internal/exitRegion.js'
import { isInterpretingReturn, isInterruptedReturn } from './internal/iteratorClose.js'
import { Pipeable, pipeThis } from './internal/pipe.js'
import { interruptionReason, RuntimeScopeExit, withActiveScope, withScopeExitSource, withoutScopeExitSources, type ActiveScopeDiagnostic } from './internal/runtimeContext.js'
import { ScopeTypeId, sameScope, scopeId, type ScopeIdentity } from './internal/scopeIdentity.js'
import { rootHandlerCaptureTarget, ScopedHandlerCapture } from './internal/scopedHandlerCapture.js'
import { settledTaskQueue } from './internal/settledQueue.js'
import { ScopedFork } from './internal/scopedFork.js'
import type { ScopedForkContext } from './internal/scopedFork.js'
import type { Task } from './Task.js'

export { sameScope, scopeId }

export interface ScopeOptions {
  readonly label?: string
  readonly diagnostic?: boolean
}

export interface Scope<Id extends PropertyKey = PropertyKey> extends ScopeIdentity<Id> {
  readonly label?: string
  readonly diagnostic?: boolean
}

declare const LifetimeTypeId: unique symbol
declare const ControlTypeId: unique symbol
declare const CurrentScopeTypeId: unique symbol
declare const ScopeHandleTypeId: unique symbol
const CurrentScopeId = Symbol('fx/Scope/current')

export type Lifetime = {
  readonly [LifetimeTypeId]: true
}

export type Control = {
  readonly [ControlTypeId]: true
}

export type ScopeHandle<S = unknown> = {
  readonly [ScopeHandleTypeId]?: S
}

export type AnyScope = Scope<PropertyKey>
export type LifetimeScope<S = unknown, Id extends PropertyKey = PropertyKey> = Scope<Id> & Lifetime & ScopeHandle<S>
export type ControlScope<S = unknown, Id extends PropertyKey = PropertyKey> = Scope<Id> & Lifetime & Control & ScopeHandle<S>
export type AnyLifetimeScope = LifetimeScope<any, PropertyKey>
export type AnyControlScope = ControlScope<any, PropertyKey>
export type CurrentLifetimeScope = LifetimeScope<typeof CurrentScopeId> & {
  readonly [CurrentScopeTypeId]: true
}

const closedScopes = new WeakSet<object>()
const closeableScopes = new WeakSet<object>()

const createScope = <Brand>(
  metadata: ScopeOptions = {},
  id: PropertyKey = Symbol(metadata.label ?? 'fx/Scope'),
  closeable = true
): Scope<PropertyKey> & Lifetime & ScopeHandle<unknown> & Brand => {
  const token = metadata.diagnostic === undefined
    ? { label: metadata.label ?? String(id) }
    : { label: metadata.label ?? String(id), diagnostic: metadata.diagnostic }
  Object.defineProperty(token, ScopeTypeId, {
    value: id,
    enumerable: false,
    writable: false,
    configurable: false
  })
  if (closeable) closeableScopes.add(token)
  return token as Scope<PropertyKey> & Lifetime & ScopeHandle<unknown> & Brand
}

export const assertScopeOpen = (scope: AnyScope): void => {
  if (!sameScope(scope, currentScope) && closedScopes.has(scope)) {
    throw new Error(`Scope handle ${scopeLabel(scope)} was used after its scope exited`)
  }
}

const closeScope = (scope: AnyScope): void => {
  if (!sameScope(scope, currentScope) && closeableScopes.has(scope)) closedScopes.add(scope)
}

const createLifetimeScope = (metadata?: ScopeOptions): AnyLifetimeScope =>
  createScope(metadata)

const createControlScope = (metadata?: ScopeOptions): AnyControlScope =>
  createScope<Control>(metadata)

export function scope<Brand>(): <const Id extends PropertyKey>(id: Id, metadata?: ScopeOptions) => Scope<Id> & Lifetime & ScopeHandle<any> & Brand
export function scope<const Id extends PropertyKey>(id: Id, metadata?: ScopeOptions): Scope<Id> & Lifetime & ScopeHandle<any>
export function scope(id?: PropertyKey, metadata: ScopeOptions = {}): any {
  if (id === undefined) return (id: PropertyKey, metadata?: ScopeOptions) => createScope(metadata, id, false)
  return createScope(metadata, id, false)
}

export function scopeLabel(scope: AnyScope): string
export function scopeLabel(scope: undefined): 'undefined'
export function scopeLabel(scope: AnyScope | undefined): string {
  if (scope === undefined) return 'undefined'
  return scope.label ?? String(scopeId(scope))
}

const createCurrentScope = (): CurrentLifetimeScope => {
  const token = { diagnostic: false }
  Object.defineProperty(token, ScopeTypeId, {
    value: CurrentScopeId,
    enumerable: false,
    writable: false,
    configurable: false
  })
  return token as CurrentLifetimeScope
}

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

/**
 * Logical nearest lifetime scope token.
 *
 * A `withScope(...)` handler treats lifetime effects addressed to this token as
 * requests for that handler's own scope boundary. This token is not a captured
 * snapshot: saving it and using it inside a nested `withScope(...)` targets the
 * nested boundary.
 */
export const currentScope: CurrentLifetimeScope = createCurrentScope() as CurrentLifetimeScope & {
  readonly [CurrentScopeTypeId]: true
}

export function withScope<const E, const A>(
  body: <S>(scope: LifetimeScope<S>) => Fx<E, A>
): Fx<ScopeEffects<E, AnyLifetimeScope>, A | ReturnValue<E, AnyLifetimeScope>>
export function withScope<const E, const A>(
  options: ScopeOptions,
  body: <S>(scope: LifetimeScope<S>) => Fx<E, A>
): Fx<ScopeEffects<E, AnyLifetimeScope>, A | ReturnValue<E, AnyLifetimeScope>>
export function withScope<const Scope extends AnyLifetimeScope>(
  scope: Scope
): <const E, const A>(f: Fx<E, A>) => Fx<ScopeEffects<E, Scope>, A | ReturnValue<E, Scope>>
export function withScope<const E, const A>(
  optionsOrBody: ScopeOptions | AnyLifetimeScope | (<S>(scope: LifetimeScope<S>) => Fx<E, A>),
  body?: <S>(scope: LifetimeScope<S>) => Fx<E, A>
): Fx<ScopeEffects<E, AnyLifetimeScope>, A | ReturnValue<E, AnyLifetimeScope>> | (<const E2, const A2>(f: Fx<E2, A2>) => Fx<ScopeEffects<E2, AnyLifetimeScope>, A2 | ReturnValue<E2, AnyLifetimeScope>>) {
  if (typeof optionsOrBody === 'object' && ScopeTypeId in optionsOrBody) {
    const scope = optionsOrBody as AnyLifetimeScope
    return <const E2, const A2>(f: Fx<E2, A2>) =>
      new ScopeBoundary(f, scope) as Fx<ScopeEffects<E2, AnyLifetimeScope>, A2 | ReturnValue<E2, AnyLifetimeScope>>
  }
  const options = typeof optionsOrBody === 'function' ? undefined : optionsOrBody
  const f = typeof optionsOrBody === 'function' ? optionsOrBody : body!
  const scope = createLifetimeScope(options)
  return new ScopeBoundary(f(scope as unknown as LifetimeScope<never>), scope) as Fx<ScopeEffects<E, AnyLifetimeScope>, A | ReturnValue<E, AnyLifetimeScope>>
}

export function withControlScope<const E, const A>(
  body: <S>(scope: ControlScope<S>) => Fx<E, A>
): Fx<ScopeEffects<E, AnyControlScope>, A | ReturnValue<E, AnyControlScope>>
export function withControlScope<const E, const A>(
  options: ScopeOptions,
  body: <S>(scope: ControlScope<S>) => Fx<E, A>
): Fx<ScopeEffects<E, AnyControlScope>, A | ReturnValue<E, AnyControlScope>>
export function withControlScope<const E, const A>(
  optionsOrBody: ScopeOptions | (<S>(scope: ControlScope<S>) => Fx<E, A>),
  body?: <S>(scope: ControlScope<S>) => Fx<E, A>
): Fx<ScopeEffects<E, AnyControlScope>, A | ReturnValue<E, AnyControlScope>> {
  const options = typeof optionsOrBody === 'function' ? undefined : optionsOrBody
  const f = typeof optionsOrBody === 'function' ? optionsOrBody : body!
  const scope = createControlScope(options)
  return new ScopeBoundary(f(scope as unknown as ControlScope<never>), scope) as Fx<ScopeEffects<E, AnyControlScope>, A | ReturnValue<E, AnyControlScope>>
}

export type ScopeEffects<E, Scope extends AnyLifetimeScope> =
  HandleScopeEffect<E, Scope> | ScopedForkEffects<E, Scope> | CleanupEffects<E, Scope> | CleanupFailure<E, Scope>

type HandleScopeEffect<E, Scope extends AnyLifetimeScope> =
  E extends Finally<HandledScope<Scope>, any> ? never
  : E extends ReturnFrom<ControlScopeOf<Scope>, any> ? never
  : E extends ScopedFork<HandledScope<Scope>> ? never
  : E extends InterruptFrom<CurrentLifetimeScope, infer Reason> ? InterruptFrom<Scope, Reason>
  : E

type ScopedForkEffects<E, Scope extends AnyLifetimeScope> =
  E extends ScopedFork<HandledScope<Scope>> ? Fork | Async | Fail<unknown> : never

type MatchingFinally<E, Scope extends AnyLifetimeScope> =
  Extract<E, Finally<HandledScope<Scope>, any>>

type HandledScope<Scope extends AnyLifetimeScope> = Scope | CurrentLifetimeScope

type ControlScopeOf<Scope extends AnyLifetimeScope> =
  Scope extends AnyControlScope ? Scope : never

type FinalizerEffects<E, Scope extends AnyLifetimeScope> =
  MatchingFinally<E, Scope> extends never
    ? never
    : MatchingFinally<E, Scope> extends Finally<HandledScope<Scope>, infer FE> ? FE : never

type CleanupEffects<E, Scope extends AnyLifetimeScope> =
  Exclude<FinalizerEffects<E, Scope>, Fail<any>>

type CleanupFailure<E, Scope extends AnyLifetimeScope> =
  MatchingFinally<E, Scope> extends never ? never : Fail<AggregateError>

export type ReturnValue<E, Scope extends AnyScope> =
  E extends ReturnFrom<infer EffectScope extends AnyControlScope, infer A>
    ? Extract<EffectScope, Scope> extends never ? never : A
    : never

class ScopeBoundary<E, A, Scope extends AnyLifetimeScope> implements Fx<unknown, A>, Pipeable, CapturedHandler {
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
    const scopedFx = root ? controller.withExitSource(this.fx) : this.fx
    const i = withMaybeActiveScope(scopedFx)[Symbol.iterator]()
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
      const { exit: finalExit, failures: taskFailures } = yield* withMaybeActiveScope(withoutScopeExitSources(controller.join(exit)))
      const finalizerFailures = yield* withMaybeActiveScope(withoutScopeExitSources(releaseSafely(controller.finalizers, finalExit)))
      return { exit: finalExit, failures: [...taskFailures, ...finalizerFailures] }
    }
    const finishRoot = function* (
      exit: Exit<Scope>,
      unhandledEffect?: AnyEffect,
      extraFailures: readonly unknown[] = []
    ): Generator<unknown, A> {
      const { exit: finalExit, failures } = yield* release(exit)
      const allFailures = [...extraFailures, ...failures]
      if (finalExit.type === 'failure') {
        const cleanupFailures = allFailures.flatMap(cleanupFailuresOf)
        if (cleanupFailures.length > 0) return (yield* withMaybeActiveScope(failCleanup([finalExit.failure.arg, ...cleanupFailures]))) as A
        return (yield finalExit.failure) as A
      }
      const cleanupFailures = allFailures.flatMap(cleanupFailuresOf)
      if (cleanupFailures.length > 0) return (yield* withMaybeActiveScope(failCleanup(cleanupFailures))) as A
      if (finalExit.type === 'returnFrom') return finalExit.value as A
      if (finalExit.type === 'abort') {
        // Abort exits are only produced by Abort effects, whose public constructors require control scopes.
        const abort = Abort.is(unhandledEffect)
          ? unhandledEffect
          : new Abort(finalExit.scope as unknown as AnyControlScope, undefined)
        return (yield abort) as A
      }
      if (finalExit.type === 'interrupted') {
        return (yield (InterruptFrom.is(unhandledEffect) ? unhandledEffect : new InterruptFrom(finalExit.scope, finalExit.reason))) as A
      }
      return finalExit.value as A
    }
    const continueWith = (value: unknown): ExitRegionStep<A> => ({ type: 'continue', value })
    const doneWith = (value: A): ExitRegionStep<A> => ({ type: 'done', value })
    const step = function* (effect: unknown): Generator<unknown, ExitRegionStep<A>, unknown> {
      if (!isEffect(effect)) {
        throw new Error(`Unexpected non-Effect value yielded ${String(effect)}`)
      }

      const effectScope = (effect as { readonly scope?: AnyScope }).scope
      const matchesScope = effectScope !== undefined && sameScope(effectScope, scope)
      const matchesLifetimeScope = matchesScope || (effectScope !== undefined && sameScope(effectScope, currentScope))

      if (matchesLifetimeScope && Finally.is(effect)) {
        controller.addFinalizer(effect.arg)
        return continueWith(undefined)
      } else if (matchesLifetimeScope && ScopedFork.is(effect)) {
        const context = yield* new ScopedHandlerCapture(rootHandlerCaptureTarget)
        const task = yield* controller.fork({
          ...effect.arg,
          fx: withHandlerContext([capturedShared, ...(context as readonly CapturedHandler[])], effect.arg.fx)
        })
        return continueWith(task)
      } else if (matchesScope && ReturnFrom.is(effect)) {
        const exit = { type: 'returnFrom', scope, value: effect.arg } satisfies Exit<Scope>
        if (!root) {
          controller.requestExit(exit)
          return doneWith(effect.arg as A)
        }
        return doneWith(yield* finishRoot(exit))
      } else if (matchesScope && Abort.is(effect)) {
        const exit = { type: 'abort', scope } satisfies Exit<Scope>
        if (!root) {
          controller.requestExit(exit)
          return doneWith(undefined as A)
        }
        return doneWith(yield* finishRoot(exit, effect))
      } else if (matchesLifetimeScope && InterruptFrom.is(effect)) {
        const exit = interruptedExit(scope, effect.arg)
        const interrupt = matchesScope ? effect : new InterruptFrom(scope, effect.arg)
        if (!root) {
          controller.requestExit(exit)
          return doneWith(undefined as A)
        }
        return doneWith(yield* finishRoot(exit, interrupt))
      } else if (Fail.is(effect)) {
        const exit = { type: 'failure', failure: effect } satisfies Exit
        if (!root) {
          return doneWith((yield effect) as A)
        }
        return doneWith(yield* finishRoot(exit))
      } else if (ScopedHandlerCapture.is(effect)) {
        const target = effect.arg
        if (target.type === 'root') {
          return continueWith([capturedShared, ...(yield effect) as any])
        } else if (target.type === 'nearestScope' || sameScope(target.scope, scope)) {
          return continueWith([capturedShared, ...(yield new ScopedHandlerCapture(rootHandlerCaptureTarget)) as any])
        }
        return continueWith(yield effect as any)
      } else if (HandlerCapture.is(effect)) {
        const local = effect.arg === 'fx/Concurrent/ForkIn' ? capturedShared : captured
        return continueWith([local, ...(yield effect) as any])
      }

      const result = yield effect
      if (result instanceof RuntimeScopeExit) {
        if (sameScope(result.scope, scope)) {
          const exit = result.exit as Exit<Scope>
          const cleanup = exit.type === 'failure' ? undefined : yield* returnFail(fx(function* () {
            return yield* drainScopeInterruptedReturn(i, step)
          }))
          const failures = cleanup === undefined
            ? []
            : Fail.is(cleanup) ? cleanupFailuresOf(cleanup.arg) : cleanup
          return doneWith(yield* finishRoot(exit, undefined, failures))
        }
        const { failures } = yield* release(interruptedExit(scope, result.reason))
        const cleanupFailures = failures.flatMap(cleanupFailuresOf)
        if (cleanupFailures.length > 0) return doneWith((yield* withMaybeActiveScope(failCleanup(cleanupFailures))) as A)
        return doneWith(yield* propagateRuntimeScopeExit(result))
      }
      return continueWith(result)
    }
    const run = function* (ir: IteratorResult<unknown, A>): Generator<unknown, A, unknown> {
      while (!ir.done) {
        const result = yield* step(ir.value)
        if (result.type === 'done') return result.value
        ir = i.next(result.value)
      }

      const exit = { type: 'success', value: ir.value } satisfies Exit<Scope, A>
      if (!root) return ir.value
      return yield* finishRoot(exit)
    }

    let completed = false
    try {
      const value = yield* run(i.next())
      completed = true
      return value
    } finally {
      const cleanupFailures = root
        ? yield* collectInterruptedCleanupFailures(scope, release, completed, isInterpretingReturn(), i, step)
        : yield* collectInterruptedChildCleanupFailures(completed, isInterpretingReturn(), i, step)
      const filteredCleanupFailures = cleanupFailures.flatMap(cleanupFailuresOf)
      if (filteredCleanupFailures.length > 0) yield* withMaybeActiveScope(failCleanup(filteredCleanupFailures))
      if (root) closeScope(scope)
    }
  }
}

class ScopeController<Scope extends AnyScope> {
  readonly finalizers = [] as Finalizer<unknown>[]
  private readonly tasks = new Map<Task<unknown, unknown>, ScopedForkContext>()
  private readonly joinFailures = [] as unknown[]
  private settled?: Exit<Scope>
  private readonly exitRequested = Promise.withResolvers<Exit<Scope>>()
  private readonly exitSource = {
    promise: this.exitRequested.promise.then(exit => new RuntimeScopeExit(this.scope, exit, interruptReason(exit)))
  }

  constructor(readonly scope: Scope) { }

  get exit() {
    return this.settled
  }

  addFinalizer(finalizer: Finalizer<unknown>) {
    this.finalizers.push(finalizer)
  }

  withExitSource<E, A>(fx: Fx<E, A>): Fx<E, A> {
    return withScopeExitSource(this.exitSource, fx)
  }

  *fork(context: ScopedForkContext): Generator<unknown, Task<unknown, unknown>, unknown> {
    const task = yield* withoutScopeExitSources(new Fork({
      fx: context.fx,
      origin: context.origin,
      trace: context.trace,
      scheduling: context.scheduling
    }) as Fx<Fork, Task<unknown, unknown>>)
    task._markHandled()
    this.tasks.set(task, context)
    this.watchTask(task)
    return task
  }

  requestExit(exit: Exit<Scope>) {
    if (this.settled === undefined) {
      this.settle(exit)
      this.exitRequested.resolve(exit)
    }
  }

  join(exit: Exit<Scope>): Fx<Async, { readonly exit: Exit<Scope>, readonly failures: readonly unknown[] }> {
    if (exit.type !== 'success' && this.settled === undefined) this.settle(exit)
    if (this.joinFailures.length > 0 && this.settled === undefined) {
      this.settle({ type: 'failure', failure: new Fail(this.joinFailures[0]) })
    }
    if (this.tasks.size === 0) return ok({ exit: this.settled ?? exit, failures: [] })
    return cooperativeAssertPromise(() => this.joinTasks(exit), at('fx/Scope/withScope/join', withScope))
  }

  private async joinTasks(initialExit: Exit<Scope>): Promise<{ readonly exit: Exit<Scope>, readonly failures: readonly unknown[] }> {
    const failures = [] as unknown[]
    const pending = new Set(this.tasks.keys())
    const settled = settledTaskQueue(pending)

    while (pending.size > 0) {
      removeInterruptedTasks(pending, this.tasks)
      const exit = this.settled
      if (exit !== undefined && exit.type !== 'success') break
      if (this.joinFailures.length > 0) {
        this.settle({ type: 'failure', failure: new Fail(this.joinFailures[0]) })
        break
      }
      if (initialExit.type === 'success' && !hasNonDaemonTask(pending, this.tasks)) break

      const result = await settled.next()
      pending.delete(result.task)
      this.tasks.delete(result.task)

      if (result.type === 'failure' && !result.task._interrupted) {
        this.settle({ type: 'failure', failure: new Fail(result.failure) })
        break
      }
    }

    const exit = this.settled ?? initialExit
    removeInterruptedTasks(pending, this.tasks)
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

  private watchTask(task: Task<unknown, unknown>) {
    const failure = this.tasks.get(task)?.failure
    task.promise.then(
      () => {
        this.tasks.delete(task)
      },
      reason => {
        const context = this.tasks.get(task)
        if (context === undefined) return
        if (task._interrupted) {
          this.tasks.delete(task)
        } else if (failure === 'task') {
          this.tasks.delete(task)
        } else if (failure === 'join') {
          this.joinFailures.push(reason)
          this.tasks.delete(task)
        } else {
          this.tasks.delete(task)
          this.requestExit({ type: 'failure', failure: new Fail(reason) })
        }
      }
    )
  }

  private settle(exit: Exit<Scope>) {
    this.settled = exit
  }
}

const hasNonDaemonTask = (
  pending: Iterable<Task<unknown, unknown>>,
  tasks: Map<Task<unknown, unknown>, ScopedForkContext>
) => {
  for (const task of pending) {
    if (tasks.get(task)?.daemon !== true) return true
  }
  return false
}

const removeInterruptedTasks = (
  pending: Set<Task<unknown, unknown>>,
  tasks: Map<Task<unknown, unknown>, ScopedForkContext>
) => {
  for (const task of pending) {
    if (task._interrupted) {
      pending.delete(task)
      tasks.delete(task)
    }
  }
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
  step: (effect: unknown) => Generator<unknown, ExitRegionStep<A>, unknown>
): Generator<unknown, readonly unknown[], unknown> {
  const failures = [] as unknown[]
  const exit = interruptedExit(scope, interruptionReason())

  yield* collectCleanupFailures(failures, function* () {
    failures.push(...(yield* release(exit)).failures)
  })

  if (!completed && shouldDrainReturn) {
    yield* collectCleanupFailures(failures, function* () {
      const result = yield* returnFail(fx(function* () {
        return yield* drainScopeInterruptedReturn(iterator, step)
      }))
      if (Fail.is(result)) failures.push(result.arg)
      else failures.push(...result)
    })
  }

  return failures
}

const collectInterruptedChildCleanupFailures = function* <A>(
  completed: boolean,
  shouldDrainReturn: boolean,
  iterator: Iterator<unknown, A, unknown>,
  step: (effect: unknown) => Generator<unknown, ExitRegionStep<A>, unknown>
): Generator<unknown, readonly unknown[], unknown> {
  const failures = [] as unknown[]

  if (!completed && shouldDrainReturn) {
    yield* collectCleanupFailures(failures, function* () {
      const result = yield* returnFail(fx(function* () {
        return yield* drainScopeInterruptedReturn(iterator, step)
      }))
      if (Fail.is(result)) failures.push(result.arg)
      else failures.push(...result)
    })
  }

  return failures
}

const interruptedExit = <Scope extends AnyScope>(scope: Scope, reason: unknown): Exit<Scope> =>
  reason === undefined
    ? { type: 'interrupted', scope }
    : { type: 'interrupted', scope, reason }

const drainScopeInterruptedReturn = function* <A>(
  iterator: Iterator<unknown, A, unknown>,
  step: (effect: unknown) => Generator<unknown, ExitRegionStep<A>, unknown>
): Generator<unknown, readonly unknown[], unknown> {
  const result = yield* drainExitRegionReturn(iterator, {
    classify: effect => Fail.is(effect) ? effect : undefined,
    step
  })
  return cleanupFailuresOfExitRegion(result)
}

const cleanupFailuresOfExitRegion = <A>(
  result: CapturedExit<Fail<unknown>> | { readonly type: 'success', readonly value: A } | undefined
): readonly unknown[] =>
    result === undefined
      ? []
      : isExitRegionSuccess(result) ? []
      : Fail.is(result) ? [result.arg]
        : [...cleanupFailuresOfExitRegion(result.primary), ...cleanupFailuresOfExitRegion(result.cleanup)]

const propagateRuntimeScopeExit = function* <A>(result: RuntimeScopeExit): Generator<unknown, A> {
  const exit = result.exit as Exit<AnyScope>
  // Return/abort runtime exits originate from control effects before being transported across scope boundaries.
  if (exit.type === 'returnFrom') return (yield new ReturnFrom(result.scope as unknown as AnyControlScope, exit.value)) as A
  if (exit.type === 'abort') return (yield new Abort(result.scope as unknown as AnyControlScope, undefined)) as A
  if (exit.type === 'interrupted') return (yield new InterruptFrom(result.scope, exit.reason)) as A
  if (exit.type === 'failure') return (yield exit.failure) as A
  return exit.value as A
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

  if (cleanupFailure === undefined && isInterruptedReturn(failure)) return []

  return cleanupFailure === undefined
    ? [failure]
    : cleanupFailure.errors.flatMap(cleanupFailuresOf)
}

const isResourceReleaseFailure = (failure: unknown): failure is AggregateError =>
  failure instanceof AggregateError && failure.message === 'Resource release failed'
  || typeof failure === 'object' && failure !== null
    && 'message' in failure && failure.message === 'Resource release failed'
    && 'errors' in failure && Array.isArray(failure.errors)
