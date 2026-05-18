import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bounded, defaultAll, firstSuccess } from '../../../src/Concurrent.js'
import { returnAll } from '../../../src/Fail.js'
import { runPromise, type Fx } from '../../../src/Fx.js'
import type { HandlerCapture } from '../../../src/HandlerCapture.js'
import type { Interrupt } from '../../../src/Interrupt.js'
import { collect } from '../../../src/Log.js'
import { scope } from '../../../src/Scope.js'
import { withClock, VirtualClock } from '../../../src/Time.js'
import type { Async } from '../../../src/Async.js'
import {
  BundleScope,
  CollectorScope,
  collectIncidentSnapshot,
  createIncidentCollectorFixture,
  type IncidentCollectorError,
  type SnapshotSummary
} from './domain.js'

describe('incident collector example', () => {
  it('writes snapshot entries and a manifest when collectors succeed', async () => {
    const fixture = createIncidentCollectorFixture({ primaryRuntimeFails: true })
    const result = await runSnapshot(fixture)

    assertSummary(result)
    assert.equal(result.incidentId, 'INC-1')
    assert.equal(result.runtimeSource, 'replica')
    assert.deepEqual(result.entries, [
      'logs:api',
      'logs:worker',
      'logs:billing',
      'metrics',
      'deploy:2026.05.17.1',
      'runtime:replica'
    ])

    const [bundle] = fixture.state().bundles
    assert.equal(bundle?.exit, 'success')
    assert.deepEqual(bundle?.entries.map(entry => entry.type), [
      'deploy',
      'service-log',
      'service-log',
      'metrics',
      'runtime',
      'service-log',
      'manifest'
    ])
  })

  it('fails the collector that caused cancellation and interrupts sibling collectors', async () => {
    const fixture = createIncidentCollectorFixture({
      failDeploy: true,
      slowLogMs: 500
    })
    const result = await runSnapshot(fixture)
    const state = fixture.state()

    assertErrorCause(result, {
      tag: 'CollectorUnavailable',
      collector: 'deploy',
      reason: 'deploy API unavailable'
    })
    assert.equal(state.bundles[0]?.exit, 'failure')
    assert.ok(!state.events.includes('read-log:done:api'))
    assert.ok(!state.events.includes('read-log:done:billing'))
    assert.ok(!state.events.includes('write:manifest'))
    assert.ok(state.events.includes('collector:logs:interrupted'))
    assert.ok(state.events.includes('collector:metrics:interrupted'))
    assert.ok(state.events.includes('collector:deploy:failure'))
    assert.ok(state.events.includes('collector:runtime:interrupted'))
    assert.ok(state.events.includes('bundle:INC-1:failure'))
  })

  it('uses the first successful runtime source when the primary source fails', async () => {
    const fixture = createIncidentCollectorFixture({ primaryRuntimeFails: true })
    const result = await runSnapshot(fixture)
    const state = fixture.state()

    assertSummary(result)
    assert.equal(result.runtimeSource, 'replica')
    assert.ok(state.events.includes('runtime:primary'))
    assert.ok(state.events.includes('runtime:replica'))
  })

  it('records named scope finalization exits for collectors and bundle resources', async () => {
    const fixture = createIncidentCollectorFixture()
    await runSnapshot(fixture)

    const events = fixture.state().events
    assert.ok(events.includes('bundle:INC-1:success'))
    assert.ok(events.includes('collector:logs:success'))
    assert.ok(events.includes('collector:metrics:success'))
    assert.ok(events.includes('collector:deploy:success'))
    assert.ok(events.includes('collector:runtime:success'))
  })

  it('records exit on each opened bundle when incident ids repeat', async () => {
    const fixture = createIncidentCollectorFixture()
    await runSnapshot(fixture)
    await runSnapshot(fixture)

    const bundles = fixture.state().bundles
    assert.deepEqual(bundles.map(bundle => [bundle.id, bundle.incidentId, bundle.exit]), [
      ['snapshot-1', 'INC-1', 'success'],
      ['snapshot-2', 'INC-1', 'success']
    ])
  })

  it('keeps domain effects visible until handlers remove them', () => {
    const program = collectIncidentSnapshot({
      incidentId: 'INC-types',
      services: ['api']
    })
    // @ts-expect-error the raw domain program still requires incident collector effects.
    const unhandled: Fx<never, SnapshotSummary> = program
    void unhandled

    const fixture = createIncidentCollectorFixture()
    const handled = program.pipe(
      fixture.handle,
      scope(CollectorScope),
      withClock(new VirtualClock(0)),
      collect,
      firstSuccess,
      defaultAll,
      bounded(6),
      scope(BundleScope),
      returnAll
    )

    const runnable: Fx<Async | HandlerCapture<string> | Interrupt, unknown> = handled
    void runnable
  })
})

const runSnapshot = async (
  fixture: ReturnType<typeof createIncidentCollectorFixture>,
  clock = new VirtualClock(Date.parse('2026-05-17T00:00:00.000Z'))
): Promise<SnapshotSummary | IncidentCollectorError | AggregateError | Error> => {
  const running = collectIncidentSnapshot({
    incidentId: 'INC-1',
    services: ['api', 'worker', 'billing']
  }).pipe(
    fixture.handle,
    scope(CollectorScope),
    withClock(clock),
    collect,
    firstSuccess,
    defaultAll,
    bounded(6),
    scope(BundleScope),
    returnAll,
    runPromise
  )

  await clock.waitAll()
  const result = await running
  return (Array.isArray(result) ? result[0] : result) as SnapshotSummary | IncidentCollectorError | AggregateError | Error
}

const assertSummary: (value: SnapshotSummary | IncidentCollectorError | AggregateError | Error) => asserts value is SnapshotSummary =
  (value): asserts value is SnapshotSummary => {
    assert.equal(typeof value, 'object')
    assert.notEqual(value, null)
    assert.ok(!('tag' in value))
    assert.ok(!(value instanceof AggregateError))
    assert.ok(!(value instanceof Error))
  }

const assertErrorCause = (value: unknown, cause: IncidentCollectorError): void => {
  assert.ok(value instanceof Error)
  assert.deepEqual(value.cause, cause)
}
