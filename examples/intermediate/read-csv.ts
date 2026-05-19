import { fx, run, type Fx } from '../../src/index.js'
import { defaultConsole, log } from '../../src/Console.js'
import { assert as assertNoFail } from '../../src/Fail.js'
import { managed, usingManaged } from '../../src/Finalization.js'
import { handleScoped } from '../../src/Handler.js'
import { returnFrom } from '../../src/ReturnFrom.js'
import { scope } from '../../src/Scope.js'
import { yieldFrom, YieldFrom, yieldScope } from '../../src/YieldFrom.js'

const ImportCsv = 'examples/intermediate/ImportCsv' as const

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

const CsvRows = yieldScope<CsvRow>()('examples/intermediate/CsvRows')
const IndexedCsvRows = yieldScope<IndexedCsvRow>()('examples/intermediate/IndexedCsvRows')

const stopImport = (reason: string) =>
  returnFrom(ImportCsv, { type: 'skipped', reason } satisfies ImportResult)

const openCsv = (path: string, text: string) => fx(function* () {
  yield* log(`opening ${path}`)

  return managed(
    { path, text } satisfies CsvFile,
    exit => log(`closing ${path} after ${exit.type}`)
  )
})

const parseCsvRows = (text: string): CsvRow[] =>
  text
    .trim()
    .split('\n')
    .map(line => line.split(',').map(cell => cell.trim()))

const readCsvRows = (file: CsvFile) => fx(function* () {
  yield* log(`reading ${file.path}`)

  for (const row of parseCsvRows(file.text)) {
    yield* yieldFrom(CsvRows, row)
  }
})

const withIndex = <E>(rows: Fx<E | YieldFrom<typeof CsvRows>, void>) => fx(function* () {
  let index = 0

  yield* rows.pipe(handleScoped(YieldFrom<typeof CsvRows>, CsvRows, effect => fx(function* () {
    yield* yieldFrom(IndexedCsvRows, { index, value: effect.arg })
    index += 1
  })))
})

const validateHeader = (header: readonly string[] | undefined) => fx(function* () {
  if (header === undefined) {
    return yield* stopImport('CSV is empty')
  }

  if (!header.includes('email')) {
    return yield* stopImport('CSV is missing email column')
  }
})

const importRows = (file: CsvFile) => fx(function* () {
  let count = 0

  yield* readCsvRows(file).pipe(
    withIndex,
    handleScoped(YieldFrom<typeof IndexedCsvRows>, IndexedCsvRows, effect => fx(function* () {
      const { index, value: row } = effect.arg

      if (index === 0) {
        return yield* validateHeader(row)
      }

      if (row.every(cell => cell === '')) {
        return yield* stopImport(`Encountered empty row after ${count} imports`)
      }

      yield* log(`importing ${row.join(' | ')}`)
      count += 1
    }))
  )

  return count
})

const importCsv = (path: string, text: string) => fx(function* () {
  const file = yield* usingManaged(ImportCsv, openCsv(path, text))
  const count = yield* importRows(file)

  return { type: 'imported', count } satisfies ImportResult
}).pipe(scope(ImportCsv))

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
    yield* log(`${path}: ${result.type}`, result)
  }
})

run(main.pipe(defaultConsole, assertNoFail))
