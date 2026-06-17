import { Abort } from '../Abort.js'
import { isEffect, type AnyEffect } from '../Effect.js'
import { Fail } from '../Fail.js'
import { Fx, fx } from '../Fx.js'
import { InterruptFrom } from '../InterruptFrom.js'
import { ReturnFrom } from '../ReturnFrom.js'
import type { AnyControlScope, AnyScope } from '../Scope.js'
import { InterruptedReturn, isInterruptedReturn } from './iteratorClose.js'
import { Pipeable, pipeThis } from './pipe.js'

type ExitEffect =
  | Fail<any>
  | ReturnFrom<AnyControlScope, any>
  | Abort<AnyControlScope>
  | InterruptFrom<AnyScope, any>

export type ResumableExit<A, E extends ExitEffect = ExitEffect> =
  | { readonly type: 'success', readonly value: A }
  | FailureExit<Extract<E, Fail<any>>>
  | ReturnFromExit<Extract<E, ReturnFrom<AnyControlScope, any>>>
  | AbortExit<Extract<E, Abort<AnyControlScope>>>
  | InterruptedExit<Extract<E, InterruptFrom<AnyScope, any>>>

export type FailureExit<E extends Fail<any>> =
  E extends never ? never : { readonly type: 'failure', readonly failure: E }

export type ReturnFromExit<E extends ReturnFrom<AnyControlScope, any>> =
  E extends never ? never : { readonly type: 'returnFrom', readonly effect: E }

export type AbortExit<E extends Abort<AnyControlScope>> =
  E extends never ? never : { readonly type: 'abort', readonly effect: E }

export type InterruptedExit<E extends InterruptFrom<AnyScope, any>> =
  E extends never ? never : { readonly type: 'interrupted', readonly effect: E }

type ResumableExitEffect<Exit> =
  Exit extends { readonly failure: infer E extends Fail<any> } ? E
  : Exit extends { readonly effect: infer E extends ExitEffect } ? E
  : never

type ExitOf<E, A> = ResumableExit<A, Extract<E, ExitEffect>>
type ReturnExitEffects<E> = Exclude<E, ExitEffect>

export const returnExit = <const E, const A>(
  f: Fx<E, A>
): Fx<ReturnExitEffects<E>, ExitOf<E, A>> =>
  new ReturnExit(f) as Fx<ReturnExitEffects<E>, ExitOf<E, A>>

export const resumeExit = <const Exit extends ResumableExit<any, any>>(
  exit: Exit
): Fx<ResumableExitEffect<Exit>, Exit extends { readonly type: 'success', readonly value: infer A } ? A : never> =>
  fx(function* () {
    if (exit.type === 'success') return exit.value
    if (exit.type === 'failure') return (yield exit.failure) as never
    return (yield exit.effect) as never
  }) as Fx<ResumableExitEffect<Exit>, Exit extends { readonly type: 'success', readonly value: infer A } ? A : never>

class ReturnExit<E, A> implements Fx<E, ResumableExit<A>>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(public readonly fx: Fx<E, A>) { }

  *[Symbol.iterator](): Iterator<E, ResumableExit<A>> {
    const i = this.fx[Symbol.iterator]()
    let exit: ResumableExit<A> | undefined

    const safeNext = (a: unknown): IteratorResult<E, A> | undefined => {
      try {
        return i.next(a)
      } catch (e) {
        if (isInterruptedReturn(e)) return undefined
        throw e
      }
    }
    const safeReturn = (): IteratorResult<E, A> | undefined => {
      try {
        return i.return?.()
      } catch (e) {
        if (isInterruptedReturn(e)) return undefined
        throw e
      }
    }
    const safeInterruptReturn = (): IteratorResult<E, A> | undefined => {
      try {
        return i.throw?.(new InterruptedReturn()) ?? i.return?.()
      } catch (e) {
        if (isInterruptedReturn(e)) return undefined
        throw e
      }
    }

    const close = function* (): Generator<E, void, unknown> {
      let ir = safeReturn()
      while (ir !== undefined && !ir.done) {

        if (!isEffect(ir.value)) {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }

        const cleanupExit = toExit<A>(ir.value)
        if (cleanupExit !== undefined) {
          exit ??= cleanupExit
          ir = safeInterruptReturn()
          continue
        }

        ir = safeNext(yield ir.value as E)
      }
    }

    let ir = i.next()
    while (!ir.done) {
      if (!isEffect(ir.value)) {
        throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
      }

      const nextExit = toExit<A>(ir.value)
      if (nextExit !== undefined) {
        exit = nextExit
        yield* close()
        if (exit === undefined) throw new Error('Exit unavailable after closing interrupted region')
        return exit
      }

      ir = i.next(yield ir.value as E)
    }

    return { type: 'success', value: ir.value }
  }
}

const toExit = <A>(effect: AnyEffect): ResumableExit<A> | undefined => {
  if (Fail.is(effect)) return { type: 'failure', failure: effect }
  if (ReturnFrom.is(effect)) return { type: 'returnFrom', effect }
  if (Abort.is(effect)) return { type: 'abort', effect }
  if (InterruptFrom.is(effect)) return { type: 'interrupted', effect }
  return undefined
}
