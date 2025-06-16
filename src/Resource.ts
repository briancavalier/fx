import { Effect } from './Effect'
import { Fx, fx, handle, unit } from './Fx'

import { Fail, fail, returnFail } from './Fail'

// ----------------------------------------------------------------------
// Resource effect to acquire and release resources within a scope

export interface Resource<E1, E2, R> {
  readonly acquire: Fx<E1, R>
  readonly release: (r: R) => Fx<E2, void>
}

export class Acquire<E> extends Effect('fx/Resource')<Resource<E, E, any>> { }

export const acquire = <const R, const E1, const E2>(
  r: Resource<E1, E2, R>
) => new Acquire<E1 | E2>(r).returning<R>()

export const finalize = <E>(release: Fx<E, void>) =>
  acquire({ acquire: unit, release: () => release })

export const scope = <const E, const A>(f: Fx<E, A>) => fx(function* () {
  const resources = [] as Fx<unknown, unknown>[]
  try {
    return yield* f.pipe(
      handle(Acquire, ({ acquire, release }) => fx(function* () {
        const a = yield* returnFail(acquire)

        if (Fail.is(a)) {
          const failures = yield* releaseSafely(resources)
          return yield* fail(new AggregateError([a.arg, ...failures], 'Resource release failed'))
        }

        resources.push(release(a))
        return a
      }))
    )
  } finally {
    const failures = yield* releaseSafely(resources)
    if (failures.length) yield* fail(new AggregateError(failures, 'Resource release failed'))
  }
}) as Fx<UnwrapAcquire<E>, A>

const releaseSafely = (resources: readonly Fx<unknown, unknown>[]) => fx(function* () {
  const failures = [] as unknown[]
  for (const release of resources) {
    const r = yield* returnFail(release)
    if (Fail.is(r)) failures.push(r.arg)
  }
  return failures
})

type UnwrapAcquire<Effect> = Effect extends Acquire<infer E> ? E : Effect
