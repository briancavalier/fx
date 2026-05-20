import * as assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bounded, defaultAll } from '@briancavalier/fx/concurrent'
import { type Async, type Fx, type Interrupt, returnAll, runPromise } from '@briancavalier/fx'

import { collect } from '@briancavalier/fx/log'
import { collectFrom, scope } from '@briancavalier/fx/scope'
import { withClock, VirtualClock } from '@briancavalier/fx/time'

import {
  AgentEvents,
  AgentSessionScope,
  runAgent,
  type AgentAnswer,
  type AgentEvent,
  type AgentError
} from './domain.js'
import { createToolAgentFixture, withFakeModel, type FakeModelOptions } from './fixture.js'
import { defaultToolSandboxPolicy, withToolSandbox, type ToolSandboxPolicy } from './sandbox.js'

describe('tool agent example', () => {
  it('plans, runs sandboxed tools in parallel, and summarizes results', async () => {
    const fixture = createToolAgentFixture()
    const { result, events } = await runToolAgent(fixture)

    assertAnswer(result)
    assert.equal(result.sessionId, 'agent-session-1')
    assert.deepEqual(result.results.map(result => result.tool), [
      'readProjectSummary',
      'searchExamples',
      'listOpenQuestions'
    ])
    assert.match(result.answer, /Recommendation/)
    assert.ok(events.includes('session:open:agent-session-1'))
    assert.ok(events.includes('session:close:agent-session-1:success'))
    assert.deepEqual(events.filter(event => event.startsWith('model:')), [
      'model:plan',
      'model:summarize'
    ])
  })

  it('rewrites unsafe fetchUrl tools before they reach the tool handler', async () => {
    const fixture = createToolAgentFixture()
    const { result, events } = await runToolAgent(fixture)

    assertAnswer(result)
    assert.ok(events.some(event => event === 'tool:start:searchExamples:safe search for https://example.com/fx/examples'))
    assert.ok(!events.some(event => event.startsWith('tool:start:fetchUrl:')))
  })

  it('validates rewritten tool calls before running them', async () => {
    const fixture = createToolAgentFixture()
    const policy: ToolSandboxPolicy = {
      ...defaultToolSandboxPolicy,
      rewrite: {
        fetchUrl: call => ({
          tool: 'shell',
          input: `curl ${call.input}`
        })
      }
    }

    const { result, events } = await runToolAgent(fixture, {
      plan: [
        { tool: 'fetchUrl', input: 'https://example.com/fx/examples' }
      ]
    }, new VirtualClock(Date.parse('2026-05-18T00:00:00.000Z')), policy)

    const error = agentErrorCause(result, 'ToolDenied')
    assert.equal(error.tool, 'shell')
    assert.ok(!events.some(event => event.startsWith('tool:start:shell:')))
  })

  it('denies original tool calls before rewriting them', async () => {
    const fixture = createToolAgentFixture()
    const policy: ToolSandboxPolicy = {
      ...defaultToolSandboxPolicy,
      deny: {
        ...defaultToolSandboxPolicy.deny,
        fetchUrl: 'external fetches are blocked'
      }
    }

    const { result, events } = await runToolAgent(fixture, {
      plan: [
        { tool: 'fetchUrl', input: 'https://example.com/fx/examples' }
      ]
    }, new VirtualClock(Date.parse('2026-05-18T00:00:00.000Z')), policy)

    const error = agentErrorCause(result, 'ToolDenied')
    assert.equal(error.tool, 'fetchUrl')
    assert.ok(!events.some(event => event.startsWith('tool:start:searchExamples:')))
  })

  it('denies shell tools with a recoverable policy failure', async () => {
    const fixture = createToolAgentFixture()

    const { result, events } = await runToolAgent(fixture, {
      plan: [
        { tool: 'readProjectSummary', input: 'package health' },
        { tool: 'shell', input: 'cat package.json' }
      ]
    })

    const error = agentErrorCause(result, 'ToolDenied')
    assert.equal(error.tool, 'shell')
    assert.ok(events.includes('session:close:agent-session-1:failure'))
    assert.ok(!events.some(event => event.startsWith('tool:start:shell:')))
  })

  it('fails when a tool fails and interrupts slower sibling tool work', async () => {
    const fixture = createToolAgentFixture({
      failTool: 'searchExamples',
      toolDelayMs: {
        readProjectSummary: 500,
        searchExamples: 20,
        listOpenQuestions: 500
      }
    })

    const { result, events } = await runToolAgent(fixture)

    const error = agentErrorCause(result, 'ToolUnavailable')
    assert.equal(error.tool, 'searchExamples')
    assert.ok(events.includes('tool:start:readProjectSummary:package health'))
    assert.ok(events.includes('tool:start:searchExamples:safe search for https://example.com/fx/examples'))
    assert.ok(!events.some(event => event.startsWith('tool:done:readProjectSummary:')))
    assert.ok(!events.some(event => event.startsWith('tool:done:listOpenQuestions:')))
    assert.ok(events.includes('session:close:agent-session-1:failure'))
  })

  it('keeps domain effects visible until handlers remove them', () => {
    const program = runAgent('type visibility')
    // @ts-expect-error the raw agent program still requires tool agent effects.
    const unhandled: Fx<never, AgentAnswer> = program
    void unhandled

    const fixture = createToolAgentFixture()
    const handled = program.pipe(
      withToolSandbox(defaultToolSandboxPolicy),
      fixture.handleTools,
      withFakeModel(),
      withClock(new VirtualClock(0)),
      collect,
      defaultAll,
      bounded(4),
      scope(AgentSessionScope),
      returnAll,
      collectFrom(AgentEvents)
    )

    const runnable: Fx<Async | Interrupt, unknown> = handled
    void runnable
  })
})

const runToolAgent = async (
  fixture: ReturnType<typeof createToolAgentFixture>,
  modelOptions: FakeModelOptions = {},
  clock = new VirtualClock(Date.parse('2026-05-18T00:00:00.000Z')),
  policy: ToolSandboxPolicy = defaultToolSandboxPolicy
): Promise<RunResult> => {
  const running = runAgent('Review the package health and recommend next steps').pipe(
    withToolSandbox(policy),
    fixture.handleTools,
    withFakeModel(modelOptions),
    withClock(clock),
    collect,
    defaultAll,
    bounded(4),
    scope(AgentSessionScope),
    returnAll,
    collectFrom(AgentEvents),
    runPromise
  )

  await clock.waitAll()
  const [valueOrLogged, events] = await running
  const value = Array.isArray(valueOrLogged) ? valueOrLogged[0] : valueOrLogged
  return { result: value, events }
}

interface RunResult {
  readonly result: AgentAnswer | AgentError | AggregateError | Error
  readonly events: readonly AgentEvent[]
}

const assertAnswer: (value: AgentAnswer | AgentError | AggregateError | Error) => asserts value is AgentAnswer =
  (value): asserts value is AgentAnswer => {
    assert.equal(typeof value, 'object')
    assert.notEqual(value, null)
    assert.ok(!('tag' in value))
    assert.ok(!(value instanceof AggregateError))
    assert.ok(!(value instanceof Error))
  }

const agentErrorCause = (
  value: AgentAnswer | AgentError | AggregateError | Error,
  tag: AgentError['tag']
): Extract<AgentError, { readonly tool: string }> => {
  const error = isAgentError(value) ? value : value instanceof Error && isAgentError(value.cause) ? value.cause : undefined

  if (error === undefined) assert.fail('expected an AgentError or Error with AgentError cause')
  assert.equal(error.tag, tag)
  assert.ok('tool' in error)
  return error
}

const isAgentError = (value: unknown): value is AgentError =>
  typeof value === 'object' && value !== null && 'tag' in value
