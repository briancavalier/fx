import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertPromise } from '../../src/Async.js'
import { provideFrom } from '../../src/Env.js'
import { Fx, bracket, fx, ok, runPromise } from '../../src/Fx.js'

type Workspace = {
  readonly workspaceDir: string
  readonly log: Log
}

type Log = Awaited<ReturnType<typeof open>>

const makeTempDir = () =>
  assertPromise(() => mkdtemp(join(tmpdir(), 'fx-workspace-')))

const removeDir = (dir: string) =>
  assertPromise(() => rm(dir, { recursive: true, force: true }).then(() => undefined))

const openLog = (dir: string) =>
  assertPromise(() => open(join(dir, 'run.log'), 'a'))

const closeLog = (log: Log) =>
  assertPromise(() => log.close())

const appendLog = (log: Log, message: string) =>
  assertPromise(() => log.appendFile(`${message}\n`))

const writeText = (path: string, text: string) =>
  assertPromise(() => writeFile(path, text))

const readText = (path: string) =>
  assertPromise(() => readFile(path, 'utf8'))

const withWorkspace = <const E, const A>(program: Fx<E, A>) =>
  bracket(
    makeTempDir(),
    removeDir,
    workspaceDir => bracket(
      openLog(workspaceDir),
      closeLog,
      log => program.pipe(provideFrom(ok({ workspaceDir, log } satisfies Workspace)))
    )
  )

const program = fx(function* ({ workspaceDir, log }: Workspace) {
  const report = join(workspaceDir, 'report.txt')

  yield* appendLog(log, `workspace: ${workspaceDir}`)
  yield* writeText(report, 'context parameters keep resource plumbing out of the program\n')
  yield* appendLog(log, `wrote: ${report}`)

  return yield* readText(report)
})

const report = await program.pipe(
  withWorkspace,
  runPromise
)

console.log(report.trim())
