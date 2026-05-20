import { fail, type Fail, type Fx, handle } from '@briancavalier/fx'

import {
  runTool,
  RunTool,
  type AgentError,
  type ToolCall,
  type ToolName,
  type ToolResult
} from './domain.js'

export interface ToolSandboxPolicy {
  readonly allow: readonly ToolName[]
  readonly deny?: Partial<Record<ToolName, string>>
  readonly rewrite?: Partial<Record<ToolName, (call: ToolCall) => ToolCall>>
}

export const defaultToolSandboxPolicy = {
  allow: ['readProjectSummary', 'searchExamples', 'listOpenQuestions'],
  deny: {
    shell: 'shell access is outside the agent sandbox'
  },
  rewrite: {
    fetchUrl: call => ({
      tool: 'searchExamples',
      input: `safe search for ${call.input}`
    })
  }
} satisfies ToolSandboxPolicy

export const withToolSandbox = (policy: ToolSandboxPolicy) =>
  <E, A>(program: Fx<E, A>) => program.pipe(
    handle(RunTool, (effect): Fx<RunTool | Fail<AgentError>, ToolResult> => {
      const original = effect.arg
      const deniedOriginal = policy.deny?.[original.tool]
      if (deniedOriginal !== undefined) {
        return fail({ tag: 'ToolDenied', tool: original.tool, reason: deniedOriginal } satisfies AgentError)
      }

      const rewrite = policy.rewrite?.[original.tool]
      const call = rewrite === undefined ? original : rewrite(original)

      const deniedCall = policy.deny?.[call.tool]
      if (deniedCall !== undefined) {
        return fail({ tag: 'ToolDenied', tool: call.tool, reason: deniedCall } satisfies AgentError)
      }

      return policy.allow.includes(call.tool)
        ? runTool(call)
        : fail({ tag: 'ToolDenied', tool: call.tool, reason: 'tool is not allowlisted' } satisfies AgentError)
    })
  )
