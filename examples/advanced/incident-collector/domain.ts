import { all, race, type All, type Race } from '@briancavalier/fx/concurrent'
import { Effect, fail, type Fail, fx, type Fx, handle, type Interrupt, ok } from '@briancavalier/fx'

import { using, usingManaged, managed, type Finally, type Managed } from '@briancavalier/fx/scope'

import { info, type Log } from '@briancavalier/fx/log'
import { sleep, type Time } from '@briancavalier/fx/time'

export const BundleScope = 'examples/advanced/incident-collector/Bundle' as const
export const CollectorScope = 'examples/advanced/incident-collector/Collector' as const

export type IncidentId = string
export type ServiceName = 'api' | 'worker' | 'billing'
export type CollectorName = 'logs' | 'metrics' | 'deploy' | 'runtime'

export interface SnapshotRequest {
  readonly incidentId: IncidentId
  readonly services: readonly ServiceName[]
}

export interface SnapshotSummary {
  readonly incidentId: IncidentId
  readonly bundleId: string
  readonly entries: readonly string[]
  readonly runtimeSource: string
}

export interface Bundle {
  readonly id: string
}

export interface ServiceLog {
  readonly service: ServiceName
  readonly lines: readonly string[]
}

export interface Metrics {
  readonly checks: readonly string[]
}

export interface DeployContext {
  readonly version: string
  readonly deployedBy: string
}

export interface RuntimeStatus {
  readonly source: string
  readonly status: string
}

export type BundleEntry =
  | { readonly type: 'service-log'; readonly service: ServiceName; readonly lines: readonly string[] }
  | { readonly type: 'metrics'; readonly checks: readonly string[] }
  | { readonly type: 'deploy'; readonly version: string; readonly deployedBy: string }
  | { readonly type: 'runtime'; readonly source: string; readonly status: string }
  | { readonly type: 'manifest'; readonly incidentId: IncidentId; readonly entries: readonly string[] }

export type IncidentCollectorError =
  { readonly tag: 'CollectorUnavailable'; readonly collector: CollectorName; readonly reason: string }

export type IncidentCollectorEffects =
  | OpenBundle
  | StartCollector
  | WriteBundleEntry
  | ReadServiceLog
  | FetchMetrics
  | FetchDeployContext
  | FetchRuntimeStatus
  | Time
  | Log
  | Finally<typeof BundleScope>
  | Finally<typeof CollectorScope, Log>
  | Interrupt
  | Fail<IncidentCollectorError>

/**
 * Request a managed bundle where snapshot artifacts can be written.
 */
export class OpenBundle extends Effect('example/IncidentCollector/OpenBundle')<IncidentId, Managed<Bundle>> { }

/**
 * Request a managed collector session for observable collector lifetime.
 */
export class StartCollector extends Effect('example/IncidentCollector/StartCollector')<CollectorName, Managed<CollectorName>> { }

/**
 * Request that an artifact be written to the active snapshot bundle.
 */
export class WriteBundleEntry extends Effect('example/IncidentCollector/WriteBundleEntry')<{
  readonly bundle: Bundle
  readonly entry: BundleEntry
}, void> { }

/**
 * Request logs for one service.
 */
export class ReadServiceLog extends Effect('example/IncidentCollector/ReadServiceLog')<ServiceName, ServiceLog> { }

/**
 * Request current service health metrics.
 */
export class FetchMetrics extends Effect('example/IncidentCollector/FetchMetrics')<IncidentId, Metrics> { }

/**
 * Request deploy context for the incident.
 */
export class FetchDeployContext extends Effect('example/IncidentCollector/FetchDeployContext')<IncidentId, DeployContext> { }

/**
 * Request runtime status from a named source.
 */
export class FetchRuntimeStatus extends Effect('example/IncidentCollector/FetchRuntimeStatus')<string, RuntimeStatus> { }

export const openBundle = (incidentId: IncidentId) => new OpenBundle(incidentId)
export const startCollector = (collector: CollectorName) => new StartCollector(collector)
export const writeBundleEntry = (bundle: Bundle, entry: BundleEntry) => new WriteBundleEntry({ bundle, entry })
export const readServiceLog = (service: ServiceName) => new ReadServiceLog(service)
export const fetchMetrics = (incidentId: IncidentId) => new FetchMetrics(incidentId)
export const fetchDeployContext = (incidentId: IncidentId) => new FetchDeployContext(incidentId)
export const fetchRuntimeStatus = (source: string) => new FetchRuntimeStatus(source)

export const collectIncidentSnapshot = (
  request: SnapshotRequest
): Fx<IncidentCollectorEffects | All<any> | Race<any> | Interrupt, SnapshotSummary> => fx(function* () {
  const bundle = yield* usingManaged(BundleScope, openBundle(request.incidentId))
  yield* info('snapshot started', { incidentId: request.incidentId, bundle: bundle.id })

  const [logs, _metrics, deploy, runtime] = yield* all([
    collectServiceLogs(bundle, request.services),
    collectMetrics(bundle, request.incidentId),
    collectDeploy(bundle, request.incidentId),
    collectRuntime(bundle)
  ])

  const entries = [
    ...logs.map(log => `logs:${log.service}`),
    'metrics',
    `deploy:${deploy.version}`,
    `runtime:${runtime.source}`
  ]

  yield* writeBundleEntry(bundle, {
    type: 'manifest',
    incidentId: request.incidentId,
    entries
  })
  yield* info('snapshot completed', { incidentId: request.incidentId, bundle: bundle.id })

  return {
    incidentId: request.incidentId,
    bundleId: bundle.id,
    entries,
    runtimeSource: runtime.source
  }
})

export interface FixtureState {
  readonly bundles: readonly BundleRecord[]
  readonly events: readonly string[]
}

export interface BundleRecord {
  readonly id: string
  readonly incidentId: IncidentId
  readonly entries: readonly BundleEntry[]
  readonly exit?: string
}

export interface FixtureOptions {
  readonly failDeploy?: boolean
  readonly primaryRuntimeFails?: boolean
  readonly slowLogMs?: number
}

export const createIncidentCollectorFixture = (options: FixtureOptions = {}) => {
  const bundles = [] as MutableBundleRecord[]
  const events = [] as string[]
  const slowLogMs = options.slowLogMs ?? 200

  const handleFixture = <E, A>(program: Fx<E, A>) => program.pipe(
    handle(OpenBundle, effect => {
      const record = openBundleRecord(bundles, effect.arg)
      return ok(managed(
        { id: record.id } satisfies Bundle,
        exit => fx(function* () {
          record.exit = exit.type
          events.push(`bundle:${effect.arg}:${exit.type}`)
        })
      ))
    }),
    handle(StartCollector, effect => ok(managed(
      effect.arg,
      exit => fx(function* () {
        events.push(`collector:${effect.arg}:${exit.type}`)
      })
    ))),
    handle(WriteBundleEntry, effect => {
      const record = bundles.find(bundle => bundle.id === effect.arg.bundle.id)
      if (record !== undefined) record.entries.push(effect.arg.entry)
      events.push(`write:${effect.arg.entry.type}`)
      return ok(undefined)
    }),
    handle(ReadServiceLog, effect => fx(function* () {
      events.push(`read-log:start:${effect.arg}`)
      yield* sleep(effect.arg === 'billing' ? slowLogMs : 40)
      events.push(`read-log:done:${effect.arg}`)
      return {
        service: effect.arg,
        lines: [`${effect.arg}: request latency normal`, `${effect.arg}: no recent errors`]
      }
    })),
    handle(FetchMetrics, effect => fx(function* () {
      yield* sleep(60)
      events.push(`metrics:${effect.arg}`)
      return { checks: ['http-5xx-rate:normal', 'queue-depth:normal'] }
    })),
    handle(FetchDeployContext, effect => fx(function* () {
      yield* sleep(30)
      events.push(`deploy:${effect.arg}`)
      if (options.failDeploy === true) {
        return yield* fail({
          tag: 'CollectorUnavailable',
          collector: 'deploy',
          reason: 'deploy API unavailable'
        } satisfies IncidentCollectorError)
      }
      return { version: '2026.05.17.1', deployedBy: 'release automation' }
    })),
    handle(FetchRuntimeStatus, effect => fx(function* () {
      const primary = effect.arg === 'primary'
      yield* sleep(primary ? 20 : 80)
      events.push(`runtime:${effect.arg}`)
      if (primary && options.primaryRuntimeFails === true) {
        return yield* fail({
          tag: 'CollectorUnavailable',
          collector: 'runtime',
          reason: 'primary status endpoint unavailable'
        } satisfies IncidentCollectorError)
      }
      return { source: effect.arg, status: 'healthy' }
    }))
  )

  return {
    handle: handleFixture,
    state: (): FixtureState => ({
      bundles: bundles.map(({ entries, ...bundle }) => ({
        ...bundle,
        entries: [...entries]
      })),
      events: [...events]
    })
  }
}

const collectServiceLogs = (bundle: Bundle, services: readonly ServiceName[]) => withCollector('logs', fx(function* () {
  const logs = yield* all(services.map(service => collectOneServiceLog(bundle, service)))
  return logs
}))

const collectOneServiceLog = (bundle: Bundle, service: ServiceName) => fx(function* () {
  const log = yield* readServiceLog(service)
  yield* writeBundleEntry(bundle, {
    type: 'service-log',
    service: log.service,
    lines: log.lines
  })
  return log
})

const collectMetrics = (bundle: Bundle, incidentId: IncidentId) => withCollector('metrics', fx(function* () {
  const metrics = yield* fetchMetrics(incidentId)
  yield* writeBundleEntry(bundle, {
    type: 'metrics',
    checks: metrics.checks
  })
  return metrics
}))

const collectDeploy = (bundle: Bundle, incidentId: IncidentId) => withCollector('deploy', fx(function* () {
  const deploy = yield* fetchDeployContext(incidentId)
  yield* writeBundleEntry(bundle, {
    type: 'deploy',
    version: deploy.version,
    deployedBy: deploy.deployedBy
  })
  return deploy
}))

const collectRuntime = (bundle: Bundle) => withCollector('runtime', fx(function* () {
  const runtime = yield* race([
    fetchRuntimeStatus('primary'),
    fetchRuntimeStatus('replica')
  ])
  yield* writeBundleEntry(bundle, {
    type: 'runtime',
    source: runtime.source,
    status: runtime.status
  })
  return runtime
}))

const withCollector = <E, A>(collector: CollectorName, program: Fx<E, A>): Fx<E | StartCollector | Log | Finally<typeof CollectorScope, Log> | Interrupt, A> => fx(function* () {
  const name = yield* usingManaged(CollectorScope, startCollector(collector))
  yield* using(
    CollectorScope,
    ok(name),
    (name, exit) => info('collector finalized', { name, exit: exit.type })
  )
  yield* info('collector started', { name })
  return yield* program
})

interface MutableBundleRecord {
  readonly id: string
  readonly incidentId: IncidentId
  readonly entries: BundleEntry[]
  exit?: string
}

const openBundleRecord = (bundles: MutableBundleRecord[], incidentId: IncidentId): MutableBundleRecord => {
  const record = {
    id: `snapshot-${bundles.length + 1}`,
    incidentId,
    entries: []
  } satisfies MutableBundleRecord
  bundles.push(record)
  return record
}
