import { Async } from './Async'
import { Effect } from './Effect'
import { Fail } from './Fail'
import { Fx, control, fx, ok } from './Fx'
import * as Task from './Task'
import { GetHandlerContext, HandlerContext, getHandlerContext } from './internal/HandlerContext'
import { Semaphore } from './internal/Semaphore'
import { acquireAndRunFork } from './internal/runFork'

export class Fork extends Effect('fx/Fork')<ForkContext, Task.Task<unknown, unknown>> { }

export const fork = <const E, const A>(f: Fx<E, A>, name = 'anonymous'): Fx<Exclude<E, Async | Fail<any>> | Fork | GetHandlerContext, Task.Task<A, ErrorsOf<E>>> => fx(function* () {
  const context = yield* getHandlerContext
  return (yield new Fork({ fx: f, context, name })) as Task.Task<A, ErrorsOf<E>>
})

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

export const bounded = (maxConcurrency: number) => <const E, const A>(f: Fx<E, A>) => fx(function* () {
  // The HandlerContext for this bounded concurrency scope won't change, so we can cache it
  const c = yield* getHandlerContext
  const s = new Semaphore(maxConcurrency)
  return yield* f.pipe(
    control(Fork, (resume, f) => ok(resume(acquireAndRunFork(f, s, c)))),
    control(GetHandlerContext, resume => ok(resume([])))
  )
})

export const unbounded = bounded(Infinity)
