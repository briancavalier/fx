import { Async } from './Async.js'
import { Breadcrumb, at } from './Breadcrumb.js'
import { Effect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, fx, map, ok } from './Fx.js'
import { Handle } from './Handler.js'
import { Scoped, handleScoped, scoped } from './Scoped.js'
import { Task, all as allTasks, race as raceTasks } from './Task.js'
import { Semaphore } from './internal/Semaphore.js'
import { acquireAndRunFork } from './internal/runFork.js'

export class Fork extends Effect('fx/Fork')<ForkContext, Task<unknown, unknown>> { }

export interface ForkContext {
  readonly fx: Fx<unknown, unknown>
  readonly origin: Breadcrumb
}

export const fork = <const E, const A>(
  f: Fx<E, A>,
  origin: Breadcrumb | string = at('fx/Fork/fork', fork)
): Fx<Exclude<E, Async | Fail<any>> | Fork | Scoped<'fx/Fork'>, Task<A, ErrorsOf<E>>> =>
  scoped('fx/Fork', f, fx =>
    ok(new Fork({ fx, origin: at(origin) }) as Fx<Fork, Task<A, ErrorsOf<E>>>)
  ) as Fx<Exclude<E, Async | Fail<any>> | Fork | Scoped<'fx/Fork'>, Task<A, ErrorsOf<E>>>

export const forkEach = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, origin = 'fx/Fork/forkEach') => fx(function* () {
  const ps = [] as Task<unknown, unknown>[]
  for (let i = 0; i < fxs.length; i++) ps.push(yield* fork(fxs[i], `${origin}[${i}]`))
  return ps
}) as Fx<Exclude<EffectsOf<Fxs[number]>, Async | Fail<any>> | Fork, {
  readonly [K in keyof Fxs]: Task<ResultOf<Fxs[K]>, ErrorsOf<EffectsOf<Fxs[K]>>>
}>

export const all = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, origin = 'fx/Fork/all') =>
  forkEach(fxs, origin).pipe(map(allTasks))

export const race = <const Fxs extends readonly Fx<unknown, unknown>[]>(fxs: Fxs, origin = 'fx/Fork/race') =>
  forkEach(fxs, origin).pipe(map(raceTasks))

export const bounded = (maxConcurrency: number) => <const E, const A>(f: Fx<E, A>): Fx<Handle<Handle<E, Fork>, Scoped<'fx/Fork'>> | Scoped<'fx/Fork'>, A> =>
  scoped('fx/Fork', f, fx =>
    ok(fx.pipe(handleScoped('fx/Fork', Fork, runForkWith(new Semaphore(maxConcurrency)))))
  ) as Fx<Handle<Handle<E, Fork>, Scoped<'fx/Fork'>> | Scoped<'fx/Fork'>, A>

export const unbounded = bounded(Infinity)

const runForkWith = (s: Semaphore) =>
  (f: ForkContext): Fx<never, Task<unknown, unknown>> =>
    ok(acquireAndRunFork(f, s))

export type EffectsOf<F> = F extends Fx<infer E, unknown> ? E : never
export type ResultOf<F> = F extends Fx<unknown, infer A> ? A : never
export type ErrorsOf<E> = Extract<E, Fail<any>>
