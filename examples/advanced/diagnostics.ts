import { all, defaultAll, unbounded } from '../../src/Concurrent.js'
import { defaultConsole, error, log } from '../../src/Console.js'
import { catchAll, fail } from '../../src/Fail.js'
import { fx, runPromise } from '../../src/Fx.js'
import { formatDiagnostic, formatError, setTraceCapturePolicy, snapshotError, withTraceCapture } from '../../src/Trace.js'
import { nodeSourceLookup } from '../../src/TraceNode.js'

const sourceLookup = nodeSourceLookup()

interface Order {
  readonly id: string
  readonly total: number
}

const loadOrder = fx(function* () {
  yield* log('load order')
  return { id: 'order-123', total: 42 }
})

const reserveInventory = (order: Order) => fx(function* () {
  yield* log('reserve inventory')
  return { orderId: order.id, reservationId: 'reservation-456' }
})

const quoteShipping = (order: Order) => fx(function* () {
  yield* log('quote shipping')
  return { orderId: order.id, carrier: 'ground' }
})

const authorizePayment = (order: Order) => fx(function* () {
  yield* log('authorize payment with trace capture')
  yield* fail(new Error('Card authorization failed'))
  return { orderId: order.id, amount: order.total, authorizationId: 'auth-789' }
})

const checkout = fx(function* () {
  const order = yield* loadOrder
  const [reservation, shipping, payment] = yield* all([
    reserveInventory(order),
    quoteShipping(order),
    authorizePayment(order)
  ]).pipe(
    withTraceCapture('full'),
    defaultAll
  )

  return { order, reservation, shipping, payment }
})

await checkout.pipe(
  catchAll(reportDiagnostic),
  unbounded,
  defaultConsole,
  runPromise
)

function reportDiagnostic(value: unknown) {
  return error([
    'Human-readable diagnostic:',
    formatDiagnostic(value, { source: { lookup: sourceLookup } }),
    '',
    'Short human-readable error:',
    formatError(value),
    '',
    'Structured diagnostic snapshot:',
    JSON.stringify(snapshotError(value), null, 2)
  ].join('\n'))
}
