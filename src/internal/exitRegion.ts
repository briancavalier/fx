import { isEffect } from '../Effect.js'
import { Fx } from '../Fx.js'
import { InterruptedReturn, isInterruptedReturn } from './iteratorClose.js'
import { Pipeable, pipeThis } from './pipe.js'

export type ExitRegionSuccess<A> = {
  readonly type: 'success'
  readonly value: A
}

export type ExitRegionWithCleanupExit<Exit> = {
  readonly type: 'withCleanupExit'
  readonly primary: Exit
  readonly cleanup: Exit
}

export type ExitRegionExit<Exit> =
  | Exit
  | ExitRegionWithCleanupExit<Exit>

export interface ExitRegionOptions<E, Exit> {
  classify(effect: E): Exit | undefined
  resume(exit: ExitRegionExit<Exit>): Fx<E, never>
  unavailableExitMessage?: string
}

export const exitRegion = <const E, const A, const Exit>(
  fx: Fx<E, A>,
  options: ExitRegionOptions<E, Exit>
): Fx<E, ExitRegionSuccess<A> | ExitRegionExit<Exit>> =>
  new ExitRegion(fx, options)

export function* drainExitRegionReturn<Y, A, R, Exit>(
  iterator: Iterator<Y, A, unknown>,
  step: (ir: IteratorResult<Y, A>) => Generator<Y, R, unknown>,
  options: Pick<ExitRegionOptions<Y, Exit>, 'classify'>
): Generator<Y, R | ExitRegionExit<Exit> | undefined, unknown> {
  let exit: Exit | undefined

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
      exit ??= cleanupExit
      ir = safeInterruptReturn()
      continue
    }

    ir = safeNext(yield ir.value as Y)
  }

  return exit ?? (ir === undefined ? undefined : yield* step(ir))
}

class ExitRegion<E, A, Exit> implements Fx<E, ExitRegionSuccess<A> | ExitRegionExit<Exit>>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly options: ExitRegionOptions<E, Exit>
  ) { }

  *[Symbol.iterator](): Iterator<E, ExitRegionSuccess<A> | ExitRegionExit<Exit>> {
    const i = this.fx[Symbol.iterator]()
    const classify = (effect: E): Exit | undefined => this.options.classify(effect)
    const resume = (exit: ExitRegionExit<Exit>): Fx<E, never> => this.options.resume(exit)
    let exit: ExitRegionExit<Exit> | undefined

    const close = function* (): Generator<E, void, unknown> {
      const closeExit = yield* drainExitRegionReturn<E, A, undefined, Exit>(i, function* () {
        return undefined
      }, {
        classify
      })
      if (closeExit !== undefined) exit = mergeCleanupExit(exit, closeExit)
    }

    let completed = false
    try {
      let ir = i.next()
      while (!ir.done) {
        if (!isEffect(ir.value)) {
          throw new Error(`Unexpected non-Effect value yielded ${String(ir.value)}`)
        }

        const nextExit = classify(ir.value)
        if (nextExit !== undefined) {
          exit = mergeCleanupExit(exit, nextExit)
          yield* close()
          if (exit === undefined) {
            throw new Error(this.options.unavailableExitMessage ?? 'Exit unavailable after closing interrupted region')
          }
          completed = true
          return exit
        }

        ir = i.next(yield ir.value as E)
      }

      completed = true
      return { type: 'success', value: ir.value }
    } finally {
      if (!completed) {
        yield* close()
        if (exit !== undefined) yield* resume(exit)
      }
    }
  }
}

const mergeCleanupExit = <Exit>(
  current: ExitRegionExit<Exit> | undefined,
  next: ExitRegionExit<Exit>
): ExitRegionExit<Exit> => {
  if (current === undefined) return next
  if (isExitRegionWithCleanupExit(current)) return current
  if (isExitRegionWithCleanupExit(next)) return {
    type: 'withCleanupExit',
    primary: current,
    cleanup: next.cleanup
  }
  return {
    type: 'withCleanupExit',
    primary: current,
    cleanup: next
  }
}

const isExitRegionWithCleanupExit = <Exit>(
  exit: ExitRegionExit<Exit>
): exit is ExitRegionWithCleanupExit<Exit> =>
  typeof exit === 'object'
  && exit !== null
  && 'type' in exit
  && exit.type === 'withCleanupExit'
