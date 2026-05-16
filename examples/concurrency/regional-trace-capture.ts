import { fx, runPromise } from "../../src/index.js"
import { all, defaultAll, unbounded } from "../../src/Concurrent.js"
import { defaultConsole, error, log } from "../../src/Console.js"
import { catchAll, fail } from "../../src/Fail.js"
import { formatDiagnostic, formatError, setTraceCapturePolicy, snapshotError, withTraceCapture } from "../../src/Trace.js"
import { nodeSourceLookup } from "../../src/TraceNode.js"

const sourceLookup = nodeSourceLookup()

// Start with tracing disabled for the whole process. The payment branch below
// opts back in for the region where we want richer diagnostics.
setTraceCapturePolicy('off')

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
  yield* log('authorize payment, tracing enabled for this region')
  yield* fail(new Error('Card authorization failed'))
  return { orderId: order.id, amount: order.total, authorizationId: 'auth-789' }
})

const checkout = fx(function* () {
  const order = yield* loadOrder
  const [reservation, shipping, payment] = yield* all([
    reserveInventory(order),
    quoteShipping(order),
    authorizePayment(order)
  ]).pipe(withTraceCapture('full') , defaultAll)

  return { order, reservation, shipping, payment }
})

await checkout.pipe(
  catchAll(errorWithTrace),
  unbounded,
  defaultConsole,
  runPromise
)

interface Order {
  readonly id: string
  readonly total: number
}

function errorWithTrace(e: unknown) {
  return error([
    'Human-readable diagnostic:',
    formatDiagnostic(e, { source: { lookup: sourceLookup } }),
    '',
    'Short human-readable error:',
    formatError(e),
    '',
    'Structured diagnostic snapshot:',
    JSON.stringify(snapshotError(e), null, 2)
  ].join('\n'))
}
