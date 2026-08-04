import { abort, managed, orReturn, restartOnAbort, usingManagedIn, withControlScope, type AnyControlScope } from '@briancavalier/fx/scope'
import { assert as assertNoFail, consoleLog, defaultConsole, fx, run } from '@briancavalier/fx'

type AuthToken = {
  readonly value: string
  readonly expired: boolean
}

type OrderSession = {
  readonly id: number
}

type OrderResult =
  | { readonly type: 'confirmed'; readonly confirmation: string }
  | { readonly type: 'failed'; readonly reason: string }

let token: AuthToken = { value: 'expired-token', expired: true }
let nextSessionId = 1
let nextConfirmationId = 1

const openOrderSession = () => fx(function* () {
  const session = { id: nextSessionId } satisfies OrderSession
  nextSessionId += 1

  yield* consoleLog(`open order session ${session.id}`)

  return managed(
    session,
    exit => consoleLog(`close order session ${session.id} after ${exit.type}`)
  )
})

const refreshToken = () => fx(function* () {
  yield* consoleLog('refresh auth token')
  token = { value: 'fresh-token', expired: false }
})

const submitToGateway = <const S extends AnyControlScope>(submitOrder: S, session: OrderSession) => fx(function* () {
  yield* consoleLog(`submit order in session ${session.id} with ${token.value}`)

  if (token.expired) {
    yield* refreshToken()
    yield* abort(submitOrder)
  }

  const confirmation = `order-${nextConfirmationId}`
  nextConfirmationId += 1

  return { type: 'confirmed', confirmation } satisfies OrderResult
})

const submitOrder = withControlScope({ label: 'submit order' }, submitOrder => fx(function* () {
  const session = yield* usingManagedIn(submitOrder, openOrderSession())
  return yield* submitToGateway(submitOrder, session)
}).pipe(
  restartOnAbort(submitOrder, { restarts: 1 }),
  orReturn(submitOrder, { type: 'failed', reason: 'auth refresh did not recover' } satisfies OrderResult)
))

const main = fx(function* () {
  const result = yield* submitOrder
  yield* consoleLog('order result', result)
})

run(main.pipe(defaultConsole, assertNoFail))
