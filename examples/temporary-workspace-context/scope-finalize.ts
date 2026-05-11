import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Async, assertPromise } from '../../src/Async.js'
import { provideFrom } from '../../src/Env.js'
import { Fx, fx, runPromise } from '../../src/Fx.js'
import { finalize, scope } from '../../src/Scope.js'

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

const workspaceContext = fx(function* () {
  const workspaceDir = yield* makeTempDir()
  let releaseLog: Fx<Async, void> = fx(function* () { })

  yield* finalize(fx(function* () {
    yield* releaseLog
    yield* removeDir(workspaceDir)
  }))

  const log = yield* openLog(workspaceDir)
  releaseLog = closeLog(log)

  return { workspaceDir, log } satisfies Workspace
})

const program = fx(function* ({ workspaceDir, log }: Workspace) {
  const report = join(workspaceDir, 'report.txt')

  yield* appendLog(log, `workspace: ${workspaceDir}`)
  yield* writeText(report, 'scope finalizers keep context resource cleanup explicit\n')
  yield* appendLog(log, `wrote: ${report}`)

  return yield* readText(report)
})

const report = await program.pipe(
  provideFrom(workspaceContext),
  scope,
  runPromise
)

console.log(report.trim())
