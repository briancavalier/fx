import { mapAll, type Fork } from '@briancavalier/fx/concurrent'
import { Async, Effect, fail, type Fail, fx, type Fx, type Interrupt } from '@briancavalier/fx'

import { scope, type Finally, type Managed, usingManagedIn, type YieldFrom, type Yielding } from '@briancavalier/fx/scope'
import { info, type Log } from '@briancavalier/fx/log'

import { type Time } from '@briancavalier/fx/time'

export const AgentSessionScope = scope('examples/advanced/tool-agent/AgentSession')
export const AgentEvents = scope<Yielding<AgentEvent>>()('examples/advanced/tool-agent/AgentEvents')

export type ToolName =
  | 'readProjectSummary'
  | 'searchExamples'
  | 'listOpenQuestions'
  | 'fetchUrl'
  | 'shell'

export interface ToolCall {
  readonly tool: ToolName
  readonly input: string
}

export interface ToolResult {
  readonly tool: ToolName
  readonly input: string
  readonly content: string
}

export type ModelRequest =
  | { readonly type: 'plan'; readonly task: string }
  | {
    readonly type: 'summarize'
    readonly task: string
    readonly results: readonly ToolResult[]
  }

export type ModelResponse =
  | { readonly type: 'plan'; readonly toolCalls: readonly ToolCall[] }
  | { readonly type: 'summary'; readonly answer: string }

export interface AgentSession {
  readonly id: string
}

export interface AgentAnswer {
  readonly task: string
  readonly sessionId: string
  readonly toolCalls: readonly ToolCall[]
  readonly results: readonly ToolResult[]
  readonly answer: string
}

export type AgentEvent =
  | `session:open:${string}`
  | `session:close:${string}:${string}`
  | `model:${ModelRequest['type']}`
  | `tool:start:${ToolName}:${string}`
  | `tool:done:${ToolName}:${string}`

export type AgentError =
  | { readonly tag: 'ToolDenied'; readonly tool: ToolName; readonly reason: string }
  | { readonly tag: 'ToolUnavailable'; readonly tool: ToolName; readonly reason: string }
  | { readonly tag: 'ModelError'; readonly reason: string; readonly cause?: unknown }

export type ToolAgentEffects =
  | AskModel
  | RunTool
  | StartAgentSession
  | Log
  | Time
  | Async
  | Fork
  | Interrupt
  | Finally<typeof AgentSessionScope, YieldFrom<typeof AgentEvents>>
  | Fail<AgentError>

/**
 * Request a model response without choosing a local fake or remote provider.
 */
export class AskModel extends Effect('example/ToolAgent/AskModel')<[ModelRequest], ModelResponse> { }

/**
 * Request that a named tool call be executed.
 */
export class RunTool extends Effect('example/ToolAgent/RunTool')<[ToolCall], ToolResult> { }

/**
 * Request a managed agent session for observable setup and cleanup.
 */
export class StartAgentSession extends Effect('example/ToolAgent/StartAgentSession')<
  [string],
  Managed<AgentSession, YieldFrom<typeof AgentEvents>>
> { }

export const askModel = (request: ModelRequest) => new AskModel(request)
export const runTool = (call: ToolCall) => new RunTool(call)
export const startAgentSession = (task: string) => new StartAgentSession(task)

export const runAgent = (
  task: string
): Fx<ToolAgentEffects, AgentAnswer> => fx(function* () {
  const session = yield* usingManagedIn(AgentSessionScope, startAgentSession(task))
  yield* info('agent session started', { session: session.id, task })

  const plan = yield* askModel({ type: 'plan', task })
  if (plan.type !== 'plan') {
    return yield* fail({ tag: 'ModelError', reason: 'model returned a summary when a plan was requested' })
  }

  const results = yield* mapAll(plan.toolCalls, runTool)
  const summary = yield* askModel({ type: 'summarize', task, results })
  if (summary.type !== 'summary') {
    return yield* fail({ tag: 'ModelError', reason: 'model returned a plan when a summary was requested' })
  }

  yield* info('agent session completed', { session: session.id, tools: results.map(result => result.tool) })

  return {
    task,
    sessionId: session.id,
    toolCalls: plan.toolCalls,
    results,
    answer: summary.answer
  }
})
