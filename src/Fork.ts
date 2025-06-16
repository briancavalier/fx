import { Async } from './Async'
import { Breadcrumb, at } from './Breadcrumb'
import { Effect } from './Effect'
import { Fail } from './Fail'
import { Fx, Handle, control, fx, map, ok } from './Fx'
import * as Task from './Task'
import { GetHandlerContext, HandlerContext, getHandlerContext } from './internal/HandlerContext'
import { Semaphore } from './internal/Semaphore'
import { acquireAndRunFork } from './internal/runFork'

export class Fork extends Effect('fx/Fork')<ForkContext, Task.Task<unknown, unknown>> { }

export const fork = <const E, const A>(
  f: Fx<E, A>,
  origin: Breadcrumb | string = at('fx/Fork/fork')
): Fx<Exclude<E, Async | Fail<any>> | Fork | GetHandlerContext, Task.Task<A, ErrorsOf<E>>> => fx(function* () {
  const context = yield* getHandlerContext
  return (yield new Fork({ fx: f, context, origin: at(origin) })) as Task.Task<A, ErrorsOf<E>>
})

export interface ForkContext {
  readonly fx: Fx<unknown, unknown>
  readonly context: readonly HandlerContext[]
  readonly origin: Breadcrumb
}

export type EffectsOf<F> = F extends Fx<infer E, unknown> ? E : never
export type ResultOf<F> = F extends Fx<unknown, infer A> ? A : never
export type ErrorsOf<E> = Extract<E, Fail<any>>

export const forkEach = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, origin = 'fx/Fork/forkEach') => fx(function* () {
  const ps = [] as Task.Task<unknown, unknown>[]
  for (let i = 0; i < fxs.length; i++) ps.push(yield* fork(fxs[i], `${origin}[${i}]`))
  return ps
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, {
  readonly [K in keyof Fxs]: Task.Task<ResultOf<Fxs[K]>, ErrorsOf<EffectsOf<Fxs[K]>>>
}>

export const all = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, origin = 'fx/Fork/all') =>
  forkEach(fxs, origin).pipe(map(Task.all))

export const race = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, origin = 'fx/Fork/race') =>
  forkEach(fxs, origin).pipe(map(Task.race))

export const bounded = (maxConcurrency: number) => <const E, const A>(f: Fx<E, A>): Fx<Handle<E, Fork> | GetHandlerContext, A> => fx(function* () {
  // The HandlerContext for this bounded concurrency scope won't change, so we can cache it
  const c = yield* getHandlerContext
  const s = new Semaphore(maxConcurrency)
  return yield* f.pipe(
    control(Fork, (resume, f) => ok(resume(acquireAndRunFork(f, s, c)))),
    control(GetHandlerContext, resume => ok(resume([])))
  ) as Fx<Handle<E, Fork>, A>
})

export const unbounded = bounded(Infinity)
