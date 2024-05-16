import { Async } from './Async'
import { Effect } from './Effect'
import { Fail } from './Fail'
import { Fx, fx, handle, ok } from './Fx'
import * as Task from './Task'
import { HandlerContext } from './internal/HandlerContext'
import { Semaphore } from './internal/Semaphore'
import { acquireAndRunFork } from './internal/runFork'

export class Fork extends Effect('fx/Fork')<ForkContext, Task.Task<unknown, unknown>> { }

export const fork = <const E, const A>(fx: Fx<E, A>, name = 'anonymous') =>
  new Fork({ fx, context: [], name }) as Fx<Exclude<E, Async | Fail<any>> | Fork, Task.Task<A, ErrorsOf<E>>>

export type ForkContext = Readonly<{
  name: string
  fx: Fx<unknown, unknown>
  context: readonly HandlerContext[]
}>

export type EffectsOf<F> = F extends Fx<infer E, unknown> ? E : never
export type ResultOf<F> = F extends Fx<unknown, infer A> ? A : never
export type ErrorsOf<E> = Extract<E, Fail<any>>

export const all = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, name = 'all') => fx(function* () {
  const ps = [] as Task.Task<unknown, unknown>[]
  for (let i = 0; i < fxs.length; i++) ps.push(yield* fork(fxs[i], `${name}:${i}`))
  return Task.all(ps)
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, Task.Task<{
  readonly [K in keyof Fxs]: ResultOf<Fxs[K]>
}, ErrorsOf<EffectsOf<Fxs[number]>>>>

export const race = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, name = 'race') => fx(function* () {
  const ps = [] as Task.Task<unknown, unknown>[]
  for (let i = 0; i < fxs.length; i++) ps.push(yield* fork(fxs[i], `${name}:${i}`))
  return Task.race(ps)
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, Task.Task<ResultOf<Fxs[number]>, ErrorsOf<EffectsOf<Fxs[number]>>>>

export const bounded = (maxConcurrency: number) => <const E, const A>(f: Fx<E, A>) => {
  const s = new Semaphore(maxConcurrency)
  return f.pipe(
    handle(Fork, f => ok(acquireAndRunFork(f, s)))
  ) as Fx<Exclude<E, Fork>, A>
}

export const unbounded = bounded(Infinity)
