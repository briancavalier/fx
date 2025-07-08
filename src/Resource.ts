import { Effect } from './Effect'
import { Fx, fx, ok } from './Fx'
import { Handle, handle } from './Handler'

import { Fail, fail, returnFail } from './Fail'

// ----------------------------------------------------------------------
// Resource effect to acquire and release resources within a scope

export type Resource<E1, E2, R> = Fx<E1, readonly [R, Fx<E2, void>]>

export class Acquire extends Effect('fx/Resource')<Resource<any, any, any>> { }

export const acquire = <const R, const E1, const E2>(
  r: Resource<E1, E2, R>
) => new Acquire(r).returning<R>() as Fx<Acquire | E1 | E2, R>

export const finalize = <E>(release: Fx<E, void>) =>
  ok([undefined, release])

export const scope = <const E, const A>(f: Fx<E, A>) => fx(function* () {
  const finalizers = [] as Fx<unknown, unknown>[]
  const result = yield* f.pipe(
    handle(Acquire, (acquire) => fx(function* () {
      const [r, release] = yield* acquire
      finalizers.push(release)
      return r
    })),
    returnFail
  )

  const failed = Fail.is(result)
  const failures = yield* releaseSafely(finalizers)
  if (failures.length > 0)
    return yield* fail(new AggregateError(
      failed ? [result.arg, ...failures] : failures,
      'Resource release failed'
    ))

  return failed ? yield* fail(result.arg) : result
}) as Fx<Handle<E, Acquire, Fail<AggregateError>>, A>

const releaseSafely = (resources: readonly Fx<unknown, unknown>[]) => fx(function* () {
  const failures = [] as unknown[]
  for (const release of resources) {
    const r = yield* returnFail(release)
    if (Fail.is(r)) failures.push(r.arg)
  }
  return failures
})
