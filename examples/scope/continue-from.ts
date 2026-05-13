import { fx, run, type Fx } from '../../src'
import { defaultConsole, log } from '../../src/Console'
import { ContinueFrom, guardFrom, isContinuedFrom, orContinue } from '../../src/ContinueFrom'
import { brand, scope } from '../../src/Scope'
import {
  YieldFrom,
  collectFrom,
  handleYieldFrom,
  yieldFrom,
  type ExcludeYieldFrom,
  type YieldInput,
  type YieldOutput,
  type Yielding
} from '../../src/YieldFrom'

const EachItem = brand<Yielding<number>>()('examples/scope/continue-from/EachItem')

const items = fx(function* () {
  yield* yieldFrom(EachItem, 1)
  yield* yieldFrom(EachItem, 2)
  yield* yieldFrom(EachItem, 3)
  yield* yieldFrom(EachItem, 4)
  yield* yieldFrom(EachItem, 5)
  return 'done'
})

const processItem = (n: number) => fx(function* () {
  yield* log(`start ${n}`)
  if (n % 2 === 0) yield* log(`skip ${n}`)
  yield* guardFrom(EachItem, n % 2 !== 0)

  yield* log(`finish ${n}`)
  yield* yieldFrom(EachItem, n * 10)
})

function forEachFrom<
  const Scope extends string & Yielding<unknown, void>,
  const E1,
  const A,
  const E2,
  const R
>(
  scopeName: Scope,
  source: Fx<E1 | YieldFrom<Scope>, A>,
  body: (value: YieldOutput<Scope>) => Fx<E2, R>
): Fx<ExcludeYieldFrom<E1, Scope> | Exclude<E2, ContinueFrom<Scope>>, A> {
  return fx(function* () {
    const runBody = (value: YieldOutput<Scope>) => fx(function* () {
      const result = yield* body(value).pipe(
        scope(scopeName),
        orContinue(scopeName)
      )

      if (isContinuedFrom(scopeName, result)) return undefined as YieldInput<Scope>
      return undefined as YieldInput<Scope>
    })

    return yield* source.pipe(
      handleYieldFrom(scopeName, runBody)
    )
  }) as Fx<ExcludeYieldFrom<E1, Scope> | Exclude<E2, ContinueFrom<Scope>>, A>
}

const main = fx(function* () {
  const [sourceResult, results] = yield* forEachFrom(EachItem, items, processItem).pipe(
    collectFrom(EachItem)
  )
  yield* log(sourceResult)
  yield* log(results)
})

run(main.pipe(defaultConsole))
