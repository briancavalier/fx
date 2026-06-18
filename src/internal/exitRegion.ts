import { isEffect } from '../Effect.js'
import { Fx } from '../Fx.js'
import { InterruptedReturn, isInterruptedReturn } from './iteratorClose.js'
import { Pipeable, pipeThis } from './pipe.js'

export type ExitRegionSuccess<A> = {
  readonly type: 'success'
  readonly value: A
}

export type CapturedCleanupExit<Exit> = {
  readonly type: 'withCleanupExit'
  readonly primary: Exit
  readonly cleanup: CapturedExit<Exit>
}

export type CapturedExit<Exit> =
  | Exit
  | CapturedCleanupExit<Exit>

export type ExitRegionResult<A, Exit> =
  | ExitRegionSuccess<A>
  | CapturedExit<Exit>

export type ExitRegionStep<A> =
  | { readonly type: 'continue', readonly value: unknown }
  | { readonly type: 'done', readonly value: A }

export interface ExitRegionOptions<E, A, Exit> {
  classify(effect: E): Exit | undefined
  step(effect: E): Generator<E, ExitRegionStep<A>, unknown>
  resume(exit: CapturedExit<Exit>): Fx<E, never>
}

export const exitRegion = <const E, const A, const Exit>(
  fx: Fx<E, A>,
  options: ExitRegionOptions<E, A, Exit>
): Fx<E, ExitRegionSuccess<A> | CapturedExit<Exit>> =>
  new ExitRegion(fx, options)

export function* drainExitRegionReturn<Y, A, Exit>(
  iterator: Iterator<Y, A, unknown>,
  options: Pick<ExitRegionOptions<Y, A, Exit>, 'classify' | 'step'>
): Generator<Y, ExitRegionResult<A, Exit> | undefined, unknown> {
  let exit: CapturedExit<Exit> | undefined

  const safeNext = (a: unknown): IteratorResult<Y, A> | undefined => {
    try {
      return iterator.next(a)
    } catch (e) {
      if (isInterruptedReturn(e)) return undefined
      throw e
    }
  }
  const safeReturn = (): IteratorResult<Y, A> | undefined => {
    try {
      return iterator.return?.()
    } catch (e) {
      if (isInterruptedReturn(e)) return undefined
      throw e
    }
  }
  const safeInterruptReturn = (): IteratorResult<Y, A> | undefined => {
    try {
      return iterator.throw?.(new InterruptedReturn()) ?? iterator.return?.()
    } catch (e) {
      if (isInterruptedReturn(e)) return undefined
      throw e
    }
  }

  let ir = safeReturn()
  while (ir !== undefined && !ir.done) {
    if (!isEffect(ir.value)) {
      throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
    }

    const cleanupExit = options.classify(ir.value)
    if (cleanupExit !== undefined) {
      exit = mergeCleanupExit(exit, cleanupExit)
      ir = safeInterruptReturn()
      continue
    }

    const result = yield* options.step(ir.value)
    if (result.type === 'done') return exit ?? { type: 'success', value: result.value }
    ir = safeNext(result.value)
  }

  return exit ?? (ir === undefined ? undefined : { type: 'success', value: ir.value })
}

class ExitRegion<E, A, Exit> implements Fx<E, ExitRegionSuccess<A> | CapturedExit<Exit>>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly options: ExitRegionOptions<E, A, Exit>
  ) { }

  *[Symbol.iterator](): Iterator<E, ExitRegionSuccess<A> | CapturedExit<Exit>> {
    const i = this.fx[Symbol.iterator]()
    const options = this.options
    let exit: CapturedExit<Exit> | undefined

    const close = function* (): Generator<E, void, unknown> {
      const closeExit = yield* drainExitRegionReturn<E, A, Exit>(i, options)
      if (closeExit !== undefined && !isExitRegionSuccess(closeExit)) exit = mergeCleanupExit(exit, closeExit)
    }

    let completed = false
    try {
      let ir = i.next()
      while (!ir.done) {
        if (!isEffect(ir.value)) {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }

        const nextExit = options.classify(ir.value)
        if (nextExit !== undefined) {
          exit = mergeCleanupExit(exit, nextExit)
          yield* close()
          completed = true
          return exit ?? nextExit
        }

        const result = yield* options.step(ir.value)
        if (result.type === 'done') {
          completed = true
          return { type: 'success', value: result.value }
        }
        ir = i.next(result.value)
      }

      completed = true
      return { type: 'success', value: ir.value }
    } finally {
      if (!completed) {
        yield* close()
        if (exit !== undefined) yield* options.resume(exit)
      }
    }
  }
}

const mergeCleanupExit = <Exit>(
  current: CapturedExit<Exit> | undefined,
  next: CapturedExit<Exit>
): CapturedExit<Exit> => {
  if (current === undefined) return next
  if (isCapturedCleanupExit(current)) return {
    type: 'withCleanupExit',
    primary: current.primary,
    cleanup: mergeCleanupExit(current.cleanup, next)
  }
  return {
    type: 'withCleanupExit',
    primary: current,
    cleanup: next
  }
}

const isCapturedCleanupExit = <Exit>(
  exit: CapturedExit<Exit>
): exit is CapturedCleanupExit<Exit> =>
  (exit as { readonly type?: unknown } | null | undefined)?.type === 'withCleanupExit'

export const isExitRegionSuccess = <A, Exit>(
  result: ExitRegionResult<A, Exit>
): result is ExitRegionSuccess<A> =>
  (result as { readonly type?: unknown } | null | undefined)?.type === 'success'
