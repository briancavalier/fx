import { withBoundedConcurrency } from '@briancavalier/fx/concurrent'
import { consoleLog, defaultConsole, fx, handleScoped, provide, returnAll, runCatch, runPromise } from '@briancavalier/fx'

import { w3cFetch } from '@briancavalier/fx/http-client'
import { withConsoleLog } from '@briancavalier/fx/log'
import { withScope, YieldFrom } from '@briancavalier/fx/scope'
import { defaultTime } from '@briancavalier/fx/time'

import {
  AgentEvents,
  AgentSessionScope,
  runAgent
} from './domain.js'
import { createToolAgentFixture, withFakeModel } from './fixture.js'
import { withOpenAIModel, type OpenAIModelContext } from './openai.js'
import { defaultToolSandboxPolicy, withToolSandbox } from './sandbox.js'

const task = process.argv.slice(2).join(' ') || 'Review the package health and recommend next steps'
const fixture = createToolAgentFixture()
const logAgentEvents = handleScoped(YieldFrom<typeof AgentEvents>, AgentEvents, effect =>
  consoleLog(`agent event: ${effect.arg}`)
)

const main = fx(function* ({ openAIApiKey }: OpenAIModelContext) {
  const result = openAIApiKey === undefined
    ? yield* runAgent(task).pipe(
      withToolSandbox(defaultToolSandboxPolicy),
      fixture.handleTools,
      withFakeModel(),
      withConsoleLog,
      defaultTime,
      withBoundedConcurrency(4),
      withScope(AgentSessionScope),
      logAgentEvents,
      returnAll, runCatch
    )
    : yield* runAgent(task).pipe(
      withToolSandbox(defaultToolSandboxPolicy),
      fixture.handleTools,
      withOpenAIModel,
      withConsoleLog,
      defaultTime,
      withBoundedConcurrency(4),
      withScope(AgentSessionScope),
      logAgentEvents,
      w3cFetch(),
      returnAll, runCatch
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
