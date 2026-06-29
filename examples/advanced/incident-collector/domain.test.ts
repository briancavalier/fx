import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { withBoundedConcurrency } from '@briancavalier/fx/concurrent'
import { type Async, type Fx, type HandlerCapture, type Interrupt, returnAll, runPromise } from '@briancavalier/fx'

import { collect } from '@briancavalier/fx/log'
import { withScope } from '@briancavalier/fx/scope'
import { withClock, VirtualClock } from '@briancavalier/fx/time'

import {
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
    assert.ok(!state.events.includes('collector:logs:success'))
    assert.ok(!state.events.includes('collector:metrics:success'))
    assert.ok(state.events.includes('collector:deploy:failure'))
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
    const fixture = createIncidentCollectorFixture()
    const handled = withScope(bundleScope =>
      withScope(collectorScope => {
        const program = collectIncidentSnapshot(bundleScope, collectorScope, {
          incidentId: 'INC-types',
          services: ['api']
        })
        // @ts-expect-error the raw domain program still requires incident collector effects.
        const unhandled: Fx<never, SnapshotSummary> = program
        void unhandled

        return program.pipe(
          fixture.handle,
          withClock(new VirtualClock(0)),
          withBoundedConcurrency(6)
        )
      })
    ).pipe(
      collect,
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
  const running = withScope({ label: 'bundle' }, bundleScope =>
    withScope({ label: 'collector' }, collectorScope => collectIncidentSnapshot(bundleScope, collectorScope, {
      incidentId: 'INC-1',
      services: ['api', 'worker', 'billing']
    }).pipe(
      fixture.handle,
      withClock(clock),
      withBoundedConcurrency(6)
    ))
  ).pipe(
    collect,
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
