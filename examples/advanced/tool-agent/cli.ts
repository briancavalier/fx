import { withBoundedConcurrency } from '@briancavalier/fx/concurrent'
import { consoleLog, defaultConsole, fx, handleKeyed, provide, returnAll, runPromise } from '@briancavalier/fx'

import { w3cFetch } from '@briancavalier/fx/http-client'
import { withConsoleLog } from '@briancavalier/fx/log'
import { withScope } from '@briancavalier/fx/scope'
import { YieldFrom } from '@briancavalier/fx/yield'
import { defaultTime } from '@briancavalier/fx/time'

import {
  AgentEvents,
  runAgent
} from './domain.js'
import { createToolAgentFixture, withFakeModel } from './fixture.js'
import { withOpenAIModel, type OpenAIModelContext } from './openai.js'
import { defaultToolSandboxPolicy, withToolSandbox } from './sandbox.js'

const task = process.argv.slice(2).join(' ') || 'Review the package health and recommend next steps'
const fixture = createToolAgentFixture()
const logAgentEvents = handleKeyed(YieldFrom<typeof AgentEvents>, AgentEvents, effect =>
  consoleLog(`agent event: ${effect.arg}`)
)

const main = fx(function* ({ openAIApiKey }: OpenAIModelContext) {
  const result = openAIApiKey === undefined
    ? yield* withScope({ label: 'agent session' }, agentSessionScope => runAgent(agentSessionScope, task).pipe(
      withToolSandbox(defaultToolSandboxPolicy),
      fixture.handleTools,
      withFakeModel(),
      withConsoleLog,
      defaultTime,
      withBoundedConcurrency(4)
    )).pipe(
      logAgentEvents,
      returnAll
    )
    : yield* withScope({ label: 'agent session' }, agentSessionScope => runAgent(agentSessionScope, task).pipe(
      withToolSandbox(defaultToolSandboxPolicy),
      fixture.handleTools,
      withOpenAIModel,
      withConsoleLog,
      defaultTime,
      withBoundedConcurrency(4),
    )).pipe(
      logAgentEvents,
      w3cFetch(),
      returnAll
    )

  yield* consoleLog(JSON.stringify(result, null, 2))
})

await main.pipe(
  provide({
    openAIApiKey: process.env.OPENAI_API_KEY,
    openAIModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
  }),
  defaultConsole,
  runPromise
)
