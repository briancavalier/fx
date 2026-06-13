import { ScopedEffect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, fx, ok } from './Fx.js'
import { handleScoped, type HandleScoped } from './Handler.js'
import { HandlerCapture, type CapturedHandler } from './HandlerCapture.js'
import type { AnyScope } from './Scope.js'
import { sameScope } from './internal/scopeIdentity.js'
import { ScopedHandlerCapture } from './internal/scopedHandlerCapture.js'
import { ScopedFork } from './internal/scopedFork.js'

declare const StatefulTypeId: unique symbol

export type Stateful<A> = {
  readonly [StatefulTypeId]: A
}

export type StateOf<Scope> =
  Scope extends Stateful<infer A> ? A : never

/**
 * Read the current state from the named scope.
 */
export class GetState<const Scope extends AnyScope & Stateful<unknown>>
  extends ScopedEffect('fx/State/Get')<Scope, void, StateOf<Scope>> { }

/**
 * Replace the current state and return a computed result.
 */
export class ModifyState<const Scope extends AnyScope & Stateful<unknown>, const B = unknown>
  extends ScopedEffect('fx/State/Modify')<Scope, (state: StateOf<Scope>) => readonly [StateOf<Scope>, B], B> { }

export type StateEffects<Scope extends AnyScope & Stateful<unknown>> =
  | GetState<Scope>
  | ModifyState<Scope>

export type ExcludeState<E, Scope extends AnyScope & Stateful<unknown>> =
  HandleScoped<HandleScoped<E, GetState<Scope>, Scope>, ModifyState<Scope>, Scope>

type TransactionalStateEffects<E, Scope extends AnyScope & Stateful<unknown>> =
  | E
  | (Extract<E, StateEffects<Scope>> extends never ? never : StateEffects<Scope>)
  | (Extract<E, Fail<any>> extends never ? never : Fail<AggregateError>)

export const getState = <const Scope extends AnyScope & Stateful<unknown>>(scope: Scope): Fx<GetState<Scope>, StateOf<Scope>> =>
  new GetState(scope, undefined)

export const modifyState = <const Scope extends AnyScope & Stateful<unknown>, const B>(
  scope: Scope,
  f: (state: StateOf<Scope>) => readonly [StateOf<Scope>, B]
): Fx<ModifyState<Scope, B>, B> =>
  new ModifyState(scope, f)

/**
 * Handle state operations for the named scope with state local to one execution.
 */
export const withState = <const Scope extends AnyScope & Stateful<unknown>>(
  scope: Scope,
  initial: StateOf<Scope>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<ExcludeState<E, Scope>, A> =>
    fx(function* () {
      let state = initial

      return yield* f.pipe(
        handleScoped(GetState<Scope>, scope, () => ok(state)),
        handleScoped(ModifyState<Scope>, scope, effect => {
          const [next, result] = effect.arg(state)
          state = next
          return ok(result)
        })
      )
    }) as Fx<ExcludeState<E, Scope>, A>

/**
 * Handle state operations for the named scope, obtaining the initial state by
 * running an Fx once per execution.
 */
export const withStateInit = <const Scope extends AnyScope & Stateful<unknown>, const IE>(
  scope: Scope,
  initially: Fx<IE, StateOf<Scope>>
) => <const E, const A>(
  f: Fx<E, A>
): Fx<IE | ExcludeState<E, Scope>, A> =>
    fx(function* () {
      const initial = yield* initially
      return yield* f.pipe(withState(scope, initial))
    }) as Fx<IE | ExcludeState<E, Scope>, A>

/**
 * Run matching state operations transactionally for the named scope.
 */
export const transactionalState = <const Scope extends AnyScope & Stateful<unknown>>(
  scope: Scope
) => <const E, const A>(
  body: Fx<E, A>
): Fx<TransactionalStateEffects<E, Scope>, A> =>
    transact(scope, body) as Fx<TransactionalStateEffects<E, Scope>, A>

const transact = <const Scope extends AnyScope & Stateful<unknown>, const E, const A>(
  scope: Scope,
  body: Fx<E, A>
): Fx<E | StateEffects<Scope> | Fail<AggregateError>, A> =>
  transactWith(scope, body, createTransactionContext<Scope>(), true)

const transactWith = <const Scope extends AnyScope & Stateful<unknown>, const E, const A>(
  scope: Scope,
  body: Fx<E, A>,
  context: TransactionContext<Scope>,
  commitOnSuccess: boolean
): Fx<E | StateEffects<Scope> | Fail<AggregateError>, A> =>
    fx(function* () {
      const iterator = body[Symbol.iterator]()

      const initialize = function* (): Generator<GetState<Scope>, StateOf<Scope>, unknown> {
        if (!context.initialized) {
          context.state = (yield new GetState(scope, undefined)) as StateOf<Scope>
          context.initialized = true
        }

        return context.state
      }

      const step = function* (
        ir: IteratorResult<E, A>,
        closing: boolean,
        cleanupFailures?: unknown[]
      ): Generator<E | StateEffects<Scope> | Fail<AggregateError>, A | undefined, unknown> {
        let captured: CapturedHandler | undefined
        while (!ir.done) {
          if (Fail.is(ir.value)) {
            const failure = ir.value
            if (!closing) {
              // Close the protected body before exposing the failure so cleanup
              // state changes are included in the discarded local state.
              const cleanupFailures: unknown[] = []
              yield* close(iterator, step, cleanupFailures)
              if (cleanupFailures.length > 0) {
                yield new Fail(new AggregateError(
                  [failure.arg, ...cleanupFailures].flatMap(cleanupFailuresOf),
                  'Resource release failed'
                ))
                return undefined
              }
            } else if (cleanupFailures !== undefined) {
              cleanupFailures.push(ir.value.arg)
              ir = iterator.next(undefined)
              continue
            }
            yield failure
            return undefined
          }

          if (GetState.is(ir.value) && sameScope(ir.value.scope, scope)) {
            ir = iterator.next(yield* initialize())
            continue
          }

          if (ModifyState.is(ir.value) && sameScope(ir.value.scope, scope)) {
            const current = yield* initialize()
            const effect = ir.value as ModifyState<Scope, unknown>
            const [next, result] = effect.arg(current)
            context.state = next
            context.dirty = true
            ir = iterator.next(result)
            continue
          }

          if (ScopedFork.is(ir.value)) {
            captured ??= capturedTransaction(scope, context)
            const scoped = ir.value
            ir = iterator.next(yield new ScopedFork(scoped.scope, {
              ...scoped.arg,
              fx: captured.wrap(scoped.arg.fx)
            }) as E)
            continue
          }

          if (HandlerCapture.is(ir.value) || ScopedHandlerCapture.is(ir.value)) {
            captured ??= capturedTransaction(scope, context)
            ir = iterator.next([captured, ...(yield ir.value) as readonly CapturedHandler[]])
            continue
          }

          ir = iterator.next(yield ir.value)
        }

        if (context.dirty && commitOnSuccess && !closing) {
          yield new ModifyState(scope, () => [context.state, undefined])
        }

        return ir.value
      }

      let completed = false
      try {
        const value = (yield* step(iterator.next(), false)) as A
        completed = true
        return value
      } finally {
        if (!completed) {
          yield* close(iterator, step)
        }
      }
    })

const close = function* <Y, E, A, R>(
  iterator: Iterator<E, A, unknown>,
  step: (ir: IteratorResult<E, A>, closing: boolean, cleanupFailures?: unknown[]) => Generator<Y, R | undefined, unknown>,
  cleanupFailures?: unknown[]
): Generator<Y, R | undefined, unknown> {
  const ir = iterator.return?.()
  if (ir === undefined) return undefined
  return yield* step(ir, true, cleanupFailures)
}

interface TransactionContext<Scope extends AnyScope & Stateful<unknown>> {
  initialized: boolean
  dirty: boolean
  state: StateOf<Scope>
}

const createTransactionContext = <Scope extends AnyScope & Stateful<unknown>>(): TransactionContext<Scope> => ({
  initialized: false,
  dirty: false,
  state: undefined as StateOf<Scope>
})

const capturedTransaction = <Scope extends AnyScope & Stateful<unknown>>(
  scope: Scope,
  context: TransactionContext<Scope>
): CapturedHandler => ({
  wrap: fx => transactWith(scope, fx, context, false)
})

const cleanupFailuresOf = (failure: unknown): readonly unknown[] => {
  const cleanupFailure = isResourceReleaseFailure(failure)
    ? failure
    : typeof failure === 'object' && failure !== null && 'cause' in failure && isResourceReleaseFailure(failure.cause)
    ? failure.cause
    : undefined

  return cleanupFailure === undefined
    ? [failure]
    : cleanupFailure.errors.flatMap(cleanupFailuresOf)
}

const isResourceReleaseFailure = (failure: unknown): failure is AggregateError =>
  failure instanceof AggregateError && failure.message === 'Resource release failed'
  || typeof failure === 'object' && failure !== null
    && 'message' in failure && failure.message === 'Resource release failed'
    && 'errors' in failure && Array.isArray(failure.errors)
