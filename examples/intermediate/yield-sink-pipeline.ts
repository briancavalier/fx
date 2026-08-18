import { consoleLog, defaultConsole, fx, run } from '@briancavalier/fx'

import { key, next, type Receiving } from '@briancavalier/fx/sink'
import { fromIterable, to, type PipeResult, type Yielding } from '@briancavalier/fx/yield'

const Numbers = key<Yielding<number>>()('examples/intermediate/yield-sink-pipeline/Numbers')
const NumberReceiver = key<Receiving<number>>()('examples/intermediate/yield-sink-pipeline/NumberReceiver')

const produceNumbers = (values: readonly number[]) =>
  fromIterable(Numbers, values)

const receiveNumbers = (count: number) => fx(function* () {
  const received: number[] = []

  for (let i = 0; i < count; ++i) {
    received.push(yield* next(NumberReceiver))
  }

  return received
})

const describeResult = (
  label: string,
  result: PipeResult<void, readonly number[]>
) =>
  result.type === 'sinkEnded'
    ? consoleLog(`${label}: sink ended after receiving ${result.value.join(', ')}`)
    : consoleLog(`${label}: source ended before the sink received enough values`)

const main = fx(function* () {
  const sinkLimited = yield* to(
    Numbers,
    NumberReceiver,
    produceNumbers([1, 2, 3, 4, 5]),
    receiveNumbers(3)
  )

  yield* describeResult('sink-limited pipeline', sinkLimited)

  const sourceLimited = yield* to(
    Numbers,
    NumberReceiver,
    produceNumbers([1, 2]),
    receiveNumbers(3)
  )

  yield* describeResult('source-limited pipeline', sourceLimited)
})

main.pipe(defaultConsole, run)
