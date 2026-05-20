import { bounded, defaultAll } from '@briancavalier/fx/concurrent'
import { consoleLog, defaultConsole } from '@briancavalier/fx'
import { provide } from '@briancavalier/fx'
import { returnAll } from '@briancavalier/fx'
import { fx, runPromise } from '@briancavalier/fx'
import { handleScoped } from '@briancavalier/fx'
import { w3cFetch } from '@briancavalier/fx/http-client'
import { withConsoleLog } from '@briancavalier/fx/log'
import { scope } from '@briancavalier/fx/scope'
import { defaultTime } from '@briancavalier/fx/time'
import { YieldFrom } from '@briancavalier/fx/scope'
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
      defaultAll,
      bounded(4),
      scope(AgentSessionScope),
      logAgentEvents,
      returnAll
    )
    : yield* runAgent(task).pipe(
      withToolSandbox(defaultToolSandboxPolicy),
      fixture.handleTools,
      withOpenAIModel,
      withConsoleLog,
      defaultTime,
      defaultAll,
      bounded(4),
      scope(AgentSessionScope),
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
