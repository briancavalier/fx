import { Async } from './Async'
import { Effect } from './Effect'
import { Fail } from './Fail'
import { Fx, fx, handle, ok } from './Fx'
import { HandlerContext } from './internal/HandlerContext'
import { Semaphore } from './internal/Semaphore'
import { runFork, withContext } from './internal/runFork'

import * as T from './Task'
import { Task } from './Task'

export class Fork extends Effect('fx/Fork')<ForkContext, T.Task<unknown, unknown>> { }

export const fork = <const E, const A>(fx: Fx<E, A>, name = 'anonymous') =>
  new Fork({ fx, context: [], name }) as Fx<Exclude<E, Async | Fail<any>> | Fork, T.Task<A, ErrorsOf<E>>>

export type ForkContext = Readonly<{
  name: string
  fx: Fx<unknown, unknown>
  context: readonly HandlerContext[]
}>

export type EffectsOf<F> = F extends Fx<infer E, unknown> ? E : never
export type ResultOf<F> = F extends Fx<unknown, infer A> ? A : never
export type ErrorsOf<E> = Extract<E, Fail<any>>

export const all = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, name = 'all') => fx(function* () {
  const ps = [] as T.Task<unknown, unknown>[]
  for (let i = 0; i < fxs.length; i++) ps.push(yield* fork(fxs[i], `${name}:${i}`))
  return T.all(ps)
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, T.Task<{
  readonly [K in keyof Fxs]: ResultOf<Fxs[K]>
}, ErrorsOf<EffectsOf<Fxs[number]>>>>

export const race = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, name = 'race') => fx(function* () {
  const ps = [] as T.Task<unknown, unknown>[]
  for (let i = 0; i < fxs.length; i++) ps.push(yield* fork(fxs[i], `${name}:${i}`))
  return T.race(ps)
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, T.Task<ResultOf<Fxs[number]>, ErrorsOf<EffectsOf<Fxs[number]>>>>

export const bounded = (maxConcurrency: number) => <const E, const A>(f: Fx<E, A>) => fx(function* () {
  const s = new Semaphore(maxConcurrency)
  return yield* f.pipe(
    handle(Fork, ({ fx, context, name }) => ok(runFork(withContext(context, fx), s, name)))
  )
}) as Fx<Exclude<E, Fork | Async | Fail<any>>, Task<A, Extract<E, Fail<any>>>>

export const unbounded = bounded(Infinity)
