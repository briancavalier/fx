import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const forbiddenRootImports = [
  '../runtime.js',
  '../Console.js',
  '../Random.js',
  '../Time.js',
  '../HttpClient.js',
  '../HttpServer.js',
  '../HttpServerNode.js',
  '../NodeProcess.js',
  '../NodeRuntime.js',
  '../Process.js',
  '../TraceNode.js'
]

const expectedExports = [
  './package.json',
  '.',
  './concurrent',
  './http-client',
  './http-server',
  './log',
  './platform-node',
  './random',
  './ref',
  './retry',
  './scope',
  './stream',
  './time',
  './timeout'
]

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.deepEqual(Object.keys(packageJson.exports).sort(), [...expectedExports].sort())
assert.equal(packageJson.sideEffects, false)
assert.equal(packageJson.main, './dist/exports/index.js')
assert.equal(packageJson.module, './dist/exports/index.js')
assert.equal(packageJson.types, './dist/exports/index.d.ts')

const root = await readFile(new URL('../dist/exports/index.js', import.meta.url), 'utf8')
for (const specifier of forbiddenRootImports) {
  assert.equal(
    root.includes(specifier),
    false,
    `root export entrypoint must not import ${specifier}`
  )
}

const [
  core,
  concurrent,
  httpClient,
  httpServer,
  log,
  platformNode,
  random,
  ref,
  retry,
  scope,
  stream,
  time,
  timeout
] = await Promise.all([
  import('@briancavalier/fx'),
  import('@briancavalier/fx/concurrent'),
  import('@briancavalier/fx/http-client'),
  import('@briancavalier/fx/http-server'),
  import('@briancavalier/fx/log'),
  import('@briancavalier/fx/platform-node'),
  import('@briancavalier/fx/random'),
  import('@briancavalier/fx/ref'),
  import('@briancavalier/fx/retry'),
  import('@briancavalier/fx/scope'),
  import('@briancavalier/fx/stream'),
  import('@briancavalier/fx/time'),
  import('@briancavalier/fx/timeout')
])

assert.equal(typeof core.fx, 'function')
assert.equal('defaultRuntime' in core, false)
assert.equal(typeof concurrent.all, 'function')
assert.equal(typeof httpClient.request, 'function')
assert.equal(typeof httpServer.route, 'function')
assert.equal(typeof log.consoleLog, 'function')
assert.equal(typeof platformNode.runNodeMain, 'function')
assert.equal(typeof random.defaultRandom, 'function')
assert.equal(typeof ref.of, 'function')
assert.equal(typeof retry.retry, 'function')
assert.equal(typeof scope.scope, 'function')
assert.equal(typeof stream.emit, 'function')
assert.equal(typeof time.sleep, 'function')
assert.equal(typeof timeout.timeout, 'function')
