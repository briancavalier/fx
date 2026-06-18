import { isEffect } from '../Effect.js'
import { Fx } from '../Fx.js'
import { InterruptedReturn, isInterruptedReturn } from './iteratorClose.js'
import { Pipeable, pipeThis } from './pipe.js'

export type ExitRegionSuccess<A> = {
  readonly type: 'success'
  readonly value: A
}

export interface ExitRegionOptions<E, Exit> {
  classify(effect: E): Exit | undefined
  resume(exit: Exit): Fx<E, never>
  keepExit?(current: Exit | undefined, next: Exit): Exit
  unavailableExitMessage?: string
}

export const exitRegion = <const E, const A, const Exit>(
  fx: Fx<E, A>,
  options: ExitRegionOptions<E, Exit>
): Fx<E, ExitRegionSuccess<A> | Exit> =>
  new ExitRegion(fx, options)

export function* drainExitRegionReturn<Y, A, R, Exit>(
  iterator: Iterator<Y, A, unknown>,
  step: (ir: IteratorResult<Y, A>) => Generator<Y, R, unknown>,
  options: Pick<ExitRegionOptions<Y, Exit>, 'classify' | 'keepExit'>
): Generator<Y, R | Exit | undefined, unknown> {
  let exit: Exit | undefined
  const keepExit = options.keepExit ?? ((_current: Exit | undefined, next: Exit) => next)

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
      exit = keepExit(exit, cleanupExit)
      ir = safeInterruptReturn()
      continue
    }

    ir = safeNext(yield ir.value as Y)
  }

  return exit ?? (ir === undefined ? undefined : yield* step(ir))
}

class ExitRegion<E, A, Exit> implements Fx<E, ExitRegionSuccess<A> | Exit>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    public readonly fx: Fx<E, A>,
    public readonly options: ExitRegionOptions<E, Exit>
  ) { }

  *[Symbol.iterator](): Iterator<E, ExitRegionSuccess<A> | Exit> {
    const i = this.fx[Symbol.iterator]()
    const classify = (effect: E): Exit | undefined => this.options.classify(effect)
    const resume = (exit: Exit): Fx<E, never> => this.options.resume(exit)
    const keepExit = (current: Exit | undefined, next: Exit): Exit =>
      this.options.keepExit?.(current, next) ?? next
    let exit: Exit | undefined

    const close = function* (): Generator<E, void, unknown> {
      const closeExit = yield* drainExitRegionReturn<E, A, undefined, Exit>(i, function* () {
        return undefined
      }, {
        classify,
        keepExit
      })
      if (closeExit !== undefined) exit = keepExit(exit, closeExit)
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
          exit = keepExit(exit, nextExit)
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
