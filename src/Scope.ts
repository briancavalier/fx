import { Effect } from './Effect.js'
import { Fx, fx, ok } from './Fx.js'
import { Handle, handle } from './Handler.js'

import { Fail, fail, returnFail } from './Fail.js'

// ----------------------------------------------------------------------
// Resource effect to acquire and release resources within a scope

export class Finalize extends Effect('fx/Finalize')<Fx<unknown, void>, void> { }

export const finalize = <E>(f: Fx<E, void>) =>
  new Finalize(f)

export const scope = <const E, const A>(f: Fx<E, A>) => fx(function* () {
  const finalizers = [] as Fx<unknown, unknown>[]
  const result = yield* f.pipe(
    handle(Finalize, finalize => ok(void finalizers.push(finalize.arg))),
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
}) as Fx<Handle<E, Finalize, Fail<AggregateError>>, A>

const releaseSafely = (resources: readonly Fx<unknown, unknown>[]) => fx(function* () {
  const failures = [] as unknown[]
  for (let i = resources.length - 1; i >= 0; --i) {
    const r = yield* returnFail(resources[i])
    if (Fail.is(r)) failures.push(r.arg)
  }
  return failures
})
