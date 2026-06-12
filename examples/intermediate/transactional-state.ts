import { catchAll, fail, fx, runCatch, runPromise } from '@briancavalier/fx'
import { scope } from '@briancavalier/fx/scope'
import { getState, modifyState, transactionalState, type Stateful, withState } from '@briancavalier/fx/state'

type Session = {
  readonly requests: number
  readonly lastRoute: string
  readonly status: string
}

const SessionState = scope<Stateful<Session>>()('example/TransactionalSession')

const initialSession: Session = {
  requests: 0,
  lastRoute: 'none',
  status: 'idle'
}

const recordRequest = (route: string) =>
  modifyState(SessionState, session => [
    {
      requests: session.requests + 1,
      lastRoute: route,
      status: `processing ${route}`
    },
    undefined
  ] as const)

const recoverSession = (error: unknown) =>
  modifyState(SessionState, session => [
    {
      ...session,
      status: `recovered from ${String(error)}`
    },
    undefined
  ] as const)

const failedSecondRequest = fx(function* () {
  yield* recordRequest('/users/1')
  yield* fail('invalid session')
})

const plainState = fx(function* () {
  yield* recordRequest('/users')
  yield* failedSecondRequest.pipe(catchAll(recoverSession))

  return yield* getState(SessionState)
}).pipe(
  runCatch,
  withState(SessionState, initialSession),
  runPromise
)

const transactional = fx(function* () {
  yield* recordRequest('/users')
  yield* failedSecondRequest.pipe(
    transactionalState(SessionState),
    catchAll(recoverSession)
  )

  return yield* getState(SessionState)
}).pipe(
  runCatch,
  withState(SessionState, initialSession),
  runPromise
)

console.log({
  plain: await plainState,
  transactional: await transactional
})
