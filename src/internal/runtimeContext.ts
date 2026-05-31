import type { Fx } from '../Fx.js'
import type { AnyScope } from '../Scope.js'
import { isEffect } from '../Effect.js'
import type { TraceCapturePolicy } from './tracePolicy.js'
import { getTraceCapturePolicy } from './tracePolicy.js'
import { Pipeable, pipeThis } from './pipe.js'

/**
 * Internal diagnostic runtime context. This currently carries trace capture
 * policy across interpreter/runtime boundaries; it is not a general service
 * or capability container.
 */
export interface RuntimeContext {
  readonly traceCapturePolicy?: TraceCapturePolicy
  readonly activeScopes?: readonly ActiveScopeDiagnostic[]
  readonly interruptionReason?: unknown
  readonly scopeExitSources?: readonly RuntimeScopeExitSource[]
  readonly scopeExit?: Promise<RuntimeScopeExit>
  readonly clearScopeExitSources?: boolean
}

export interface ActiveScopeDiagnostic {
  readonly id: PropertyKey
  readonly label: string
}

export interface RuntimeScopeExitSource {
  readonly promise: Promise<RuntimeScopeExit>
}

export class RuntimeScopeExit {
  constructor(
    readonly scope: AnyScope,
    readonly exit: unknown,
    readonly reason?: unknown
  ) { }
}

export const RuntimeContextTypeId = Symbol('fx/RuntimeContext')

let activeRuntimeContext: RuntimeContext | undefined

export const currentRuntimeContext = (): RuntimeContext | undefined =>
  activeRuntimeContext

export const withActiveRuntimeContext = <A>(context: RuntimeContext, f: () => A): A => {
  const previous = activeRuntimeContext
  activeRuntimeContext = previous === undefined
    ? context
    : mergeRuntimeContext(previous, context)
  try {
    return f()
  } finally {
    activeRuntimeContext = previous
  }
}

export const withRuntimeContext = <E, A>(
  context: RuntimeContext | undefined,
  fx: Fx<E, A>
): Fx<E, A> =>
  context === undefined ? fx : new RuntimeContextFx(fx, context)

export const attachRuntimeContext = (target: unknown, context: RuntimeContext | undefined = activeRuntimeContext): void => {
  if (context === undefined || typeof target !== 'object' || target === null) return
  if ((target as Partial<Record<typeof RuntimeContextTypeId, RuntimeContext>>)[RuntimeContextTypeId] !== undefined) return

  try {
    Object.defineProperty(target, RuntimeContextTypeId, {
      value: context,
      enumerable: false,
      writable: false,
      configurable: true
    })
  } catch {
    // Preserve the original thrown value if runtime metadata cannot be attached.
  }
}

export const getRuntimeContext = (target: unknown): RuntimeContext | undefined =>
  typeof target === 'object' && target !== null
    ? (target as Partial<Record<typeof RuntimeContextTypeId, RuntimeContext>>)[RuntimeContextTypeId]
    : undefined

export const traceCapturePolicy = (context: RuntimeContext | undefined = activeRuntimeContext): TraceCapturePolicy =>
  context?.traceCapturePolicy ?? getTraceCapturePolicy()

export const capturesTrace = (context?: RuntimeContext): boolean =>
  traceCapturePolicy(context) !== 'off'

export const capturesStack = (context?: RuntimeContext): boolean =>
  traceCapturePolicy(context) === 'full'

export const activeScopes = (context: RuntimeContext | undefined = activeRuntimeContext): readonly ActiveScopeDiagnostic[] =>
  context?.activeScopes ?? []

export const interruptionReason = (context: RuntimeContext | undefined = activeRuntimeContext): unknown =>
  context?.interruptionReason

export const withInterruptionReason = (
  context: RuntimeContext | undefined,
  reason: unknown
): RuntimeContext | undefined =>
  reason === undefined ? context : { ...context, interruptionReason: reason }

export const withActiveScope = <E, A>(scope: ActiveScopeDiagnostic, fx: Fx<E, A>): Fx<E, A> => {
  const scopes = activeScopes()
  const previousScope = scopes.at(-1)
  const nextScopes = previousScope?.id === scope.id
    ? scopes
    : [...scopes, scope]
  return withRuntimeContext({ activeScopes: nextScopes }, fx)
}

export const withScopeExitSource = <E, A>(source: RuntimeScopeExitSource, fx: Fx<E, A>): Fx<E, A> =>
  withRuntimeContext({ scopeExitSources: [source], scopeExit: source.promise }, fx)

export const withoutScopeExitSources = <E, A>(fx: Fx<E, A>): Fx<E, A> =>
  withRuntimeContext({ scopeExitSources: [], scopeExit: undefined, clearScopeExitSources: true }, fx)

export const runtimeScopeExit = (context: RuntimeContext | undefined): Promise<RuntimeScopeExit> | undefined =>
  context?.clearScopeExitSources === true ? undefined : context?.scopeExit

const mergeRuntimeContext = (
  previous: RuntimeContext | undefined,
  next: RuntimeContext
): RuntimeContext => {
  const scopeExitSources = next.clearScopeExitSources === true
    ? next.scopeExitSources
    : previous?.scopeExitSources === undefined
    ? next.scopeExitSources
    : next.scopeExitSources === undefined
      ? previous.scopeExitSources
      : [...previous.scopeExitSources, ...next.scopeExitSources]
  const scopeExit = next.clearScopeExitSources === true
    ? next.scopeExit
    : previous?.scopeExit === undefined
    ? next.scopeExit
    : next.scopeExit === undefined
      ? previous.scopeExit
      : Promise.race([previous.scopeExit, next.scopeExit])
  return {
    ...previous,
    ...next,
    scopeExitSources,
    scopeExit
  }
}

class RuntimeContextFx<E, A> implements Fx<E, A>, Pipeable {
  public readonly pipe = pipeThis as Pipeable['pipe']

  constructor(
    private readonly fx: Fx<E, A>,
    private readonly context: RuntimeContext
  ) { }

  [Symbol.iterator](): Iterator<E, A, unknown> {
    const iterator = withActiveRuntimeContext(this.context, () => this.fx[Symbol.iterator]())
    return new RuntimeContextIterator(iterator, this.context)
  }
}

class RuntimeContextIterator<E, A> implements Iterator<E, A, unknown> {
  constructor(
    private readonly iterator: Iterator<E, A, unknown>,
    private readonly context: RuntimeContext
  ) { }

  next(value?: unknown): IteratorResult<E, A> {
    return this.run(() => this.iterator.next(value))
  }

  return(value?: unknown): IteratorResult<E, A> {
    return this.run(() => this.iterator.return?.(value as A) ?? { done: true, value: value as A })
  }

  throw(error?: unknown): IteratorResult<E, A> {
    return this.run(() => {
      if (this.iterator.throw === undefined) throw error
      return this.iterator.throw(error as any)
    })
  }

  private run(f: () => IteratorResult<E, A>): IteratorResult<E, A> {
    return withActiveRuntimeContext(this.context, () => {
      try {
        const result = f()
        if (!result.done && isEffect(result.value)) attachRuntimeContext(result.value)
        return result
      } catch (e) {
        attachRuntimeContext(e)
        throw e
      }
    })
  }
}
