import { catchAll, fail, fx, runCatchScoped, runPromise } from '@briancavalier/fx'
import { scope } from '@briancavalier/fx/scope'
import { getState, modifyState, type Stateful, withCheckpointedState } from '@briancavalier/fx/state'

type Session = {
  readonly attempts: number
  readonly status: string
}

const SessionState = scope<Stateful<Session>>()('example/CheckpointedSession')

const program = fx(function* () {
  yield* fx(function* () {
    yield* modifyState(SessionState, session => [
      { attempts: session.attempts + 1, status: 'processing' },
      undefined
    ])

    yield* fail('invalid session')
  }).pipe(
    catchAll(error =>
      modifyState(SessionState, session => [
        { attempts: session.attempts, status: `recovered from ${error}` },
        undefined
      ])
    ),
    runCatchScoped(SessionState)
  )

  return yield* getState(SessionState)
})

await program.pipe(
  withCheckpointedState(SessionState, { attempts: 0, status: 'idle' }),
  runPromise
).then(console.log)
