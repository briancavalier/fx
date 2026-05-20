import { bounded, defaultAll } from '../../../src/Concurrent.js'
import { defaultConsole, log } from '../../../src/Console.js'
import { provide } from '../../../src/Env.js'
import { returnAll } from '../../../src/Fail.js'
import { fx, runPromise } from '../../../src/Fx.js'
import { handleScoped } from '../../../src/Handler.js'
import { w3cFetch } from '../../../src/HttpClient.js'
import { withConsoleLog } from '../../../src/Log.js'
import { scope } from '../../../src/Scope.js'
import { defaultTime } from '../../../src/Time.js'
import { YieldFrom } from '../../../src/YieldFrom.js'
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
  log(`agent event: ${effect.arg}`)
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

  yield* log(JSON.stringify(result, null, 2))
})

await main.pipe(
  provide({
    openAIApiKey: process.env.OPENAI_API_KEY,
    openAIModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
  }),
  defaultConsole,
  runPromise
)
