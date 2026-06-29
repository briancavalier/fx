import { assert as assertNoFail, type Console, consoleLog, defaultConsole, fx, type Fx, handleKeyed, run } from '@briancavalier/fx'

import { managed, returnFrom, usingManagedIn, withControlScope, type AnyControlScope } from '@briancavalier/fx/scope'
import { key, yieldFrom, YieldFrom, type Yielding } from '@briancavalier/fx/yield'

type ImportResult =
  | { readonly type: 'imported'; readonly count: number }
  | { readonly type: 'skipped'; readonly reason: string }

type CsvFile = {
  readonly path: string
  readonly text: string
}

type CsvRow = string[]

type IndexedCsvRow = {
  readonly index: number
  readonly value: CsvRow
}

const CsvRows = key<Yielding<CsvRow>>()('examples/intermediate/CsvRows')
const IndexedCsvRows = key<Yielding<IndexedCsvRow>>()('examples/intermediate/IndexedCsvRows')

const stopImport = (scope: AnyControlScope, reason: string) =>
  returnFrom(scope, { type: 'skipped', reason } satisfies ImportResult)

const openCsv = (path: string, text: string) => fx(function* () {
  yield* consoleLog(`opening ${path}`)

  return managed(
    { path, text } satisfies CsvFile,
    exit => consoleLog(`closing ${path} after ${exit.type}`)
  )
})

const parseCsvRows = (text: string): CsvRow[] =>
  text
    .trim()
    .split('\n')
    .map(line => line.split(',').map(cell => cell.trim()))

const readCsvRows = (file: CsvFile) => fx(function* () {
  yield* consoleLog(`reading ${file.path}`)

  for (const row of parseCsvRows(file.text)) {
    yield* yieldFrom(CsvRows, row)
  }
})

const withIndex = <E>(rows: Fx<E | YieldFrom<typeof CsvRows>, void>) => fx(function* () {
  let index = 0

  yield* rows.pipe(handleKeyed(YieldFrom<typeof CsvRows>, CsvRows, effect => fx(function* () {
    yield* yieldFrom(IndexedCsvRows, { index, value: effect.arg })
    index += 1
  })))
})

const validateHeader = (scope: AnyControlScope, header: readonly string[] | undefined) => fx(function* () {
  if (header === undefined) {
    return yield* stopImport(scope, 'CSV is empty')
  }

  if (!header.includes('email')) {
    return yield* stopImport(scope, 'CSV is missing email column')
  }
})

const importRows = (scope: AnyControlScope, file: CsvFile) => fx(function* () {
  let count = 0

  yield* readCsvRows(file).pipe(
    withIndex,
    handleKeyed(YieldFrom<typeof IndexedCsvRows>, IndexedCsvRows, effect => fx(function* () {
      const { index, value: row } = effect.arg

      if (index === 0) {
        return yield* validateHeader(scope, row)
      }

      if (row.every(cell => cell === '')) {
        return yield* stopImport(scope, `Encountered empty row after ${count} imports`)
      }

      yield* consoleLog(`importing ${row.join(' | ')}`)
      count += 1
    }))
  )

  return count
})

const importCsv = (path: string, text: string): Fx<Console, ImportResult> => withControlScope({ label: 'CSV import' }, importScope => fx(function* () {
  const file = yield* usingManagedIn(importScope, openCsv(path, text))
  const count = yield* importRows(importScope, file)

  return { type: 'imported', count } satisfies ImportResult
})) as Fx<Console, ImportResult>

const goodCsv = `
name,email
Ada Lovelace,ada@example.com
Grace Hopper,grace@example.com
`

const missingEmailCsv = `
name,phone
Ada Lovelace,555-0100
`

const main = fx(function* () {
  for (const [path, text] of [
    ['good.csv', goodCsv],
    ['missing-email.csv', missingEmailCsv]
  ] as const) {
    const result = yield* importCsv(path, text)
    yield* consoleLog(`${path}: ${result.type}`, result)
  }
})

run(main.pipe(defaultConsole, assertNoFail))
