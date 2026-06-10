import { catchAll, fail, fx, runCatch, runCatchScoped, runPromise } from '@briancavalier/fx'
import { scope } from '@briancavalier/fx/scope'
import { getState, modifyState, type Stateful, withCheckpointedState, withState } from '@briancavalier/fx/state'

type Session = {
  readonly requests: number
  readonly lastRoute: string
  readonly status: string
}

const SessionState = scope<Stateful<Session>>()('example/CheckpointedSession')

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

const recoverSession = (error: string) =>
  modifyState(SessionState, session => [
    {
      ...session,
      status: `recovered from ${error}`
    },
    undefined
  ] as const)

const failedSecondRequest = fx(function* () {
  yield* recordRequest('/users/1')
  yield* fail('invalid session')
})

const plainState = fx(function* () {
  yield* recordRequest('/users')
  yield* failedSecondRequest.pipe(
    catchAll(recoverSession),
    runCatch
  )

  return yield* getState(SessionState)
}).pipe(
  withState(SessionState, initialSession),
  runPromise
)

const checkpointedState = fx(function* () {
  yield* recordRequest('/users')
  yield* failedSecondRequest.pipe(
    catchAll(recoverSession),
    runCatchScoped(SessionState)
  )

  return yield* getState(SessionState)
}).pipe(
  withCheckpointedState(SessionState, initialSession),
  runPromise
)

console.log({
  plain: await plainState,
  checkpointed: await checkpointedState
})
