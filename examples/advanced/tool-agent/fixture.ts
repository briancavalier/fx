import { fail } from '@briancavalier/fx'
import { fx, type Fx } from '@briancavalier/fx'
import { managed } from '@briancavalier/fx/scope'
import { handle } from '@briancavalier/fx'
import { sleep } from '@briancavalier/fx/time'
import { yieldFrom } from '@briancavalier/fx/scope'
import {
  AgentEvents,
  AskModel,
  RunTool,
  StartAgentSession,
  type AgentError,
  type AgentSession,
  type ModelRequest,
  type ModelResponse,
  type ToolCall,
  type ToolName,
  type ToolResult
} from './domain.js'

export const createToolAgentFixture = (options: FixtureOptions = {}) => {
  let nextSessionId = 1
  const toolDelayMs = options.toolDelayMs ?? {
    readProjectSummary: 80,
    searchExamples: 40,
    listOpenQuestions: 120,
    fetchUrl: 60,
    shell: 10
  }

  const handleTools = <E, A>(program: Fx<E, A>) => program.pipe(
    handle(StartAgentSession, () => fx(function* () {
      const id = `agent-session-${nextSessionId}`
      nextSessionId += 1
      yield* yieldFrom(AgentEvents, `session:open:${id}`)
      return managed(
        { id } satisfies AgentSession,
        exit => fx(function* () {
          yield* yieldFrom(AgentEvents, `session:close:${id}:${exit.type}`)
        })
      )
    })),
    handle(RunTool, effect => fx(function* () {
      yield* yieldFrom(AgentEvents, `tool:start:${effect.arg.tool}:${effect.arg.input}`)
      yield* sleep(toolDelayMs[effect.arg.tool] ?? 30)

      if (options.failTool === effect.arg.tool) {
        return yield* fail({
          tag: 'ToolUnavailable',
          tool: effect.arg.tool,
          reason: `${effect.arg.tool} is unavailable`
        } satisfies AgentError)
      }

      yield* yieldFrom(AgentEvents, `tool:done:${effect.arg.tool}:${effect.arg.input}`)
      return fakeToolResult(effect.arg)
    }))
  )

  return {
    handleTools
  }
}

export interface FixtureOptions {
  readonly failTool?: ToolName
  readonly toolDelayMs?: Partial<Record<ToolName, number>>
}

export const withFakeModel = ({
  plan = fallbackPlan
}: FakeModelOptions = {}) =>
  handle(AskModel, effect => fx(function* () {
    yield* yieldFrom(AgentEvents, `model:${effect.arg.type}`)
    return fakeModelResponse(effect.arg, plan)
  }))

export interface FakeModelOptions {
  readonly plan?: readonly ToolCall[]
}

const fakeModelResponse = (
  request: ModelRequest,
  plan: readonly ToolCall[] = fallbackPlan
): ModelResponse => {
  if (request.type === 'plan') return { type: 'plan', toolCalls: plan }

  const facts = request.results
    .map(result => `${result.tool}: ${result.content}`)
    .join('; ')

  return {
    type: 'summary',
    answer: `Recommendation for "${request.task}": keep the package healthy by checking project metadata, example coverage, and open questions. Evidence: ${facts}.`
  }
}

const fallbackPlan = [
  { tool: 'readProjectSummary', input: 'package health' },
  { tool: 'fetchUrl', input: 'https://example.com/fx/examples' },
  { tool: 'listOpenQuestions', input: 'agent example follow-ups' }
] satisfies readonly ToolCall[]

const fakeToolResult = (call: ToolCall): ToolResult => {
  switch (call.tool) {
    case 'readProjectSummary':
      return { ...call, content: 'package scripts include test, typecheck, build, and lint' }

    case 'searchExamples':
      return { ...call, content: `examples search matched advanced workflows for ${call.input}` }

    case 'listOpenQuestions':
      return { ...call, content: 'memory integration is a clear follow-up, not part of the first example' }

    case 'fetchUrl':
      return { ...call, content: `direct URL fetch skipped for ${call.input}` }

    case 'shell':
      return { ...call, content: `shell command was not executed: ${call.input}` }
  }
}
