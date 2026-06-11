import { catchAll, checkpoint, fail, fx, runCatch, runPromise } from '@briancavalier/fx'
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
  yield* failedSecondRequest.pipe(catchAll(recoverSession))

  return yield* getState(SessionState)
}).pipe(
  runCatch,
  withState(SessionState, initialSession),
  runPromise
)

const checkpointedState = fx(function* () {
  yield* recordRequest('/users')
  yield* failedSecondRequest.pipe(
    checkpoint(SessionState),
    catchAll(recoverSession)
  )

  return yield* getState(SessionState)
}).pipe(
  runCatch,
  withCheckpointedState(SessionState, initialSession),
  runPromise
)

console.log({
  plain: await plainState,
  checkpointed: await checkpointedState
})
