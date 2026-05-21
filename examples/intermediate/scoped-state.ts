import { consoleLog, defaultConsole, fx, runPromise } from '@briancavalier/fx'
import { brand, scope } from '@briancavalier/fx/scope'
import { getState, modifyState, type Stateful, withState } from '@briancavalier/fx/state'

type Session = {
  readonly requests: number
  readonly lastRoute: string
}

const SessionState = brand<Stateful<Session>>()('example/SessionState')

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
  scope(SessionState),
  withState(SessionState, { requests: 0, lastRoute: 'none' }),
  defaultConsole,
  runPromise
).then(console.log)
