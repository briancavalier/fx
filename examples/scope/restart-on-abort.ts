import { abort, orReturn, restartOnAbort } from '../../src/Abort'
import { defaultConsole, log } from '../../src/Console'
import { assert as assertNoFail } from '../../src/Fail'
import { managed, usingManaged } from '../../src/Finalization'
import { fx, run } from '../../src/Fx'

const SubmitOrder = 'examples/scope/restart-on-abort/SubmitOrder' as const

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

  yield* log(`open order session ${session.id}`)

  return managed(
    session,
    exit => log(`close order session ${session.id} after ${exit.type}`)
  )
})

const refreshToken = () => fx(function* () {
  yield* log('refresh auth token')
  token = { value: 'fresh-token', expired: false }
})

const submitToGateway = (session: OrderSession) => fx(function* () {
  yield* log(`submit order in session ${session.id} with ${token.value}`)

  if (token.expired) {
    yield* refreshToken()
    yield* abort(SubmitOrder)
  }

  const confirmation = `order-${nextConfirmationId}`
  nextConfirmationId += 1

  return { type: 'confirmed', confirmation } satisfies OrderResult
})

const submitOrder = fx(function* () {
  const session = yield* usingManaged(SubmitOrder, openOrderSession())
  return yield* submitToGateway(session)
}).pipe(
  restartOnAbort(SubmitOrder, { restarts: 1 }),
  orReturn(SubmitOrder, { type: 'failed', reason: 'auth refresh did not recover' } satisfies OrderResult)
)

const main = fx(function* () {
  const result = yield* submitOrder
  yield* log('order result', result)
})

run(main.pipe(defaultConsole, assertNoFail))
