import { catchAll, failFrom, type Fail } from '../../../src/Fail.js'
import { flatMap, fx, ok, type Fx } from '../../../src/Fx.js'
import { handle } from '../../../src/Handler.js'
import {
  expectSuccess,
  json,
  request,
  type JSONValue
} from '../../../src/HttpClient.js'
import {
  AskModel,
  type AgentError,
  type ModelRequest,
  type ModelResponse,
  type ToolCall,
  type ToolName
} from './domain.js'

export type OpenAIModelContext = {
  readonly openAIApiKey?: string
  readonly openAIModel: string
}

const askOpenAI = (effect: AskModel) => fx(function* ({
  openAIApiKey,
  openAIModel
}: OpenAIModelContext) {
  if (openAIApiKey === undefined) {
    return yield* failFrom(effect, {
      tag: 'ModelError',
      reason: 'OPENAI_API_KEY is required for OpenAI model mode'
    } satisfies AgentError)
  }

  return yield* request({
    method: 'POST',
    url: new URL('https://api.openai.com/v1/responses'),
    headers: [
      ['authorization', `Bearer ${openAIApiKey}`],
      ['accept', 'application/json']
    ],
    body: {
      type: 'json',
      value: {
        model: openAIModel,
        input: openAIInput(effect.arg)
      }
    }
  }).pipe(
    flatMap(expectSuccess),
    flatMap(json),
    flatMap(body => parseOpenAIResponse(effect, body)),
    catchAll(cause => failFrom(effect, isAgentError(cause)
      ? cause
      : { tag: 'ModelError', reason: 'OpenAI model request failed', cause }))
  )
})

export const withOpenAIModel = handle(AskModel, askOpenAI)

const parseOpenAIResponse = (
  effect: AskModel,
  body: JSONValue
): Fx<Fail<AgentError>, ModelResponse> => {
  const text = openAIOutputText(body)
  if (text === undefined) {
    return failFrom(effect, { tag: 'ModelError', reason: 'OpenAI response did not contain output text' })
  }

  if (effect.arg.type === 'plan') {
    return ok({ type: 'plan', toolCalls: parseToolPlan(text) })
  }

  return ok({ type: 'summary', answer: text.trim() })
}

const openAIInput = (modelRequest: ModelRequest): string => {
  if (modelRequest.type === 'plan') {
    return [
      'Plan tool calls for this task.',
      'Return only JSON: {"toolCalls":[{"tool":"readProjectSummary|searchExamples|listOpenQuestions|fetchUrl","input":"..."}]}.',
      'Use at most three calls. Prefer safe local tools.',
      `Task: ${modelRequest.task}`
    ].join('\n')
  }

  return [
    'Summarize these tool results in one concise recommendation.',
    `Task: ${modelRequest.task}`,
    JSON.stringify(modelRequest.results)
  ].join('\n')
}

const openAIOutputText = (body: JSONValue): string | undefined => {
  if (!isRecord(body)) return undefined
  if (typeof body.output_text === 'string') return body.output_text

  const output = body.output
  if (!Array.isArray(output)) return undefined

  const text: string[] = []
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === 'string') text.push(content.text)
    }
  }

  return text.length === 0 ? undefined : text.join('\n')
}

const parseToolPlan = (text: string): readonly ToolCall[] => {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!isRecord(parsed) || !Array.isArray(parsed.toolCalls)) return fallbackPlan

    const calls = parsed.toolCalls.filter(isToolCall)
    return calls.length === 0 ? fallbackPlan : calls.slice(0, 3)
  } catch {
    return fallbackPlan
  }
}

const fallbackPlan = [
  { tool: 'readProjectSummary', input: 'package health' },
  { tool: 'fetchUrl', input: 'https://example.com/fx/examples' },
  { tool: 'listOpenQuestions', input: 'agent example follow-ups' }
] satisfies readonly ToolCall[]

const isToolCall = (value: unknown): value is ToolCall =>
  isRecord(value)
  && isToolName(value.tool)
  && typeof value.input === 'string'

const isToolName = (value: unknown): value is ToolName =>
  value === 'readProjectSummary'
  || value === 'searchExamples'
  || value === 'listOpenQuestions'
  || value === 'fetchUrl'
  || value === 'shell'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isAgentError = (value: unknown): value is AgentError =>
  isRecord(value)
  && typeof value.tag === 'string'
  && (value.tag === 'ToolDenied' || value.tag === 'ToolUnavailable' || value.tag === 'ModelError')
