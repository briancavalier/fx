import { fx, run } from '../../src'
import { defaultConsole, log } from '../../src/Console'
import { managed, usingManaged } from '../../src/Finalization'
import { returnFrom } from '../../src/ReturnFrom'
import { scope } from '../../src/Scope'

const ImportCsv = 'examples/scope/ImportCsv' as const

type ImportResult =
  | { readonly type: 'imported'; readonly count: number }
  | { readonly type: 'skipped'; readonly reason: string }

type CsvFile = {
  readonly path: string
  readonly text: string
}

const stopImport = (reason: string) =>
  returnFrom(ImportCsv, { type: 'skipped', reason } satisfies ImportResult)

const openCsv = (path: string, text: string) => fx(function* () {
  yield* log(`opening ${path}`)

  return managed(
    { path, text } satisfies CsvFile,
    exit => log(`closing ${path} after ${exit.type}`)
  )
})

const readCsv = (file: CsvFile) => fx(function* () {
  yield* log(`reading ${file.path}`)

  return file.text
    .trim()
    .split('\n')
    .map(line => line.split(',').map(cell => cell.trim()))
})

const validateHeader = (header: readonly string[] | undefined) => fx(function* () {
  if (header === undefined) {
    yield* stopImport('CSV is empty')
  }

  if (!header.includes('email')) {
    yield* stopImport('CSV is missing email column')
  }
})

const importRows = (rows: readonly (readonly string[])[]) => fx(function* () {
  let count = 0

  for (const row of rows) {
    if (row.every(cell => cell === '')) {
      yield* stopImport(`Encountered empty row after ${count} imports`)
    }

    yield* log(`importing ${row.join(' | ')}`)
    count += 1
  }

  return count
})

const importCsv = (path: string, text: string) => fx(function* () {
  const file = yield* usingManaged(ImportCsv, openCsv(path, text))
  const [header, ...rows] = yield* readCsv(file)

  yield* validateHeader(header)
  const count = yield* importRows(rows)

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

run(main.pipe(defaultConsole))
