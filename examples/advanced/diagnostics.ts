import { all, withUnboundedConcurrency } from '@briancavalier/fx/concurrent'
import { withCoopConcurrency } from '@briancavalier/fx/experimental/concurrent'
import { catchAll, consoleError, consoleLog, defaultConsole, fail, fx, runPromise } from '@briancavalier/fx'

import { nodeSourceLookup } from '@briancavalier/fx/platform-node'
import { formatDiagnostic, formatError, snapshotError, withTraceCapture } from '@briancavalier/fx/trace'

const sourceLookup = nodeSourceLookup()

interface Order {
  readonly id: string
  readonly total: number
}

const loadOrder = fx(function* () {
  yield* consoleLog('load order')
  return { id: 'order-123', total: 42 }
})

const reserveInventory = (order: Order) => fx(function* () {
  yield* consoleLog('reserve inventory')
  return { orderId: order.id, reservationId: 'reservation-456' }
})

const quoteShipping = (order: Order) => fx(function* () {
  yield* consoleLog('quote shipping')
  return { orderId: order.id, carrier: 'ground' }
})

const authorizePayment = (order: Order) => fx(function* () {
  yield* consoleLog('authorize payment with trace capture')
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
    // Toggle All handler:
    // withUnboundedConcurrency
    // withCoopConcurrency({ yieldBudget: 64 })
    withCoopConcurrency({ yieldBudget: 64 })
  )

  return { order, reservation, shipping, payment }
})

await checkout.pipe(
  catchAll(reportDiagnostic),
  withUnboundedConcurrency,
  defaultConsole,
  runPromise
)

function reportDiagnostic(value: unknown) {
  return consoleError([
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
