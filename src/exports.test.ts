import assert from 'node:assert/strict'
import test from 'node:test'

import * as Core from './exports/index.js'
import * as Concurrent from './exports/concurrent.js'
import * as HttpClient from './exports/http-client.js'
import * as HttpServer from './exports/http-server.js'
import * as Log from './exports/log.js'
import * as PlatformNode from './exports/platform-node.js'
import * as Random from './exports/random.js'
import * as Ref from './exports/ref.js'
import * as Retry from './exports/retry.js'
import * as Scope from './exports/scope.js'
import * as Stream from './exports/stream.js'
import * as Time from './exports/time.js'
import * as Timeout from './exports/timeout.js'

test('root export surface contains small-program core', () => {
  assert.equal(typeof Core.fx, 'function')
  assert.equal(typeof Core.ok, 'function')
  assert.equal(typeof Core.run, 'function')
  assert.equal(typeof Core.runPromise, 'function')
  assert.equal(typeof Core.handle, 'function')
  assert.equal(typeof Core.fail, 'function')
  assert.equal(typeof Core.catchAll, 'function')
  assert.equal(typeof Core.tryPromise, 'function')
  assert.equal(typeof Core.get, 'function')
  assert.equal(typeof Core.provideAll, 'function')
  assert.equal(typeof Core.Task, 'function')
  assert.equal(typeof Core.formatDiagnostic, 'function')
})

test('root export surface excludes optional feature and platform modules', () => {
  assert.equal('defaultRuntime' in Core, false)
  assert.equal('defaultConsole' in Core, false)
  assert.equal('defaultRandom' in Core, false)
  assert.equal('defaultTime' in Core, false)
  assert.equal('serve' in Core, false)
  assert.equal('request' in Core, false)
  assert.equal('all' in Core, false)
  assert.equal('signal' in Core, false)
  assert.equal('runNodeMain' in Core, false)
})

test('feature export surfaces group related functionality', () => {
  assert.equal(typeof Concurrent.all, 'function')
  assert.equal(typeof HttpClient.request, 'function')
  assert.equal(typeof HttpServer.route, 'function')
  assert.equal(typeof Log.consoleLog, 'function')
  assert.equal(typeof Log.defaultConsole, 'function')
  assert.equal(typeof Log.log, 'function')
  assert.equal(typeof PlatformNode.runNodeMain, 'function')
  assert.equal(typeof Random.defaultRandom, 'function')
  assert.equal(typeof Ref.of, 'function')
  assert.equal(typeof Retry.retry, 'function')
  assert.equal(typeof Scope.scope, 'function')
  assert.equal(typeof Stream.emit, 'function')
  assert.equal(typeof Time.sleep, 'function')
  assert.equal(typeof Timeout.timeout, 'function')
})
