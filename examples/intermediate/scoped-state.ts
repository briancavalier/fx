import { consoleLog, defaultConsole, fx, ok, runPromise } from '@briancavalier/fx'
import { scope, withScope } from '@briancavalier/fx/scope'
import { getState, modifyState, type Stateful, withStateInit } from '@briancavalier/fx/state'

type Session = {
  readonly requests: number
  readonly lastRoute: string
}

const SessionState = scope<Stateful<Session>>()('example/SessionState')

const recordRequest = (route: string) =>
  modifyState(SessionState, session => [
    { requests: session.requests + 1, lastRoute: route },
    session.requests + 1
  ] as const)

const program = fx(function* () {
  const first = yield* recordRequest('/users')
  const second = yield* recordRequest('/users/1')
  const session = yield* getState(SessionState)

  yield* consoleLog(`handled ${first} then ${second} requests`)
  return session
})

await program.pipe(
  withScope(SessionState),
  withStateInit(SessionState, ok({ requests: 0, lastRoute: 'none' })),
  defaultConsole,
  runPromise
).then(console.log)
