import { Effect } from '../Effect.js'
import { Fx } from '../Fx.js'
import { withHandlerContext, type CapturedHandler } from '../HandlerCapture.js'
import type { AnyScope } from '../Scope.js'

export type ScopedHandlerCaptureTarget =
  | { readonly type: 'root' }
  | { readonly type: 'nearestScope' }
  | { readonly type: 'scope'; readonly scope: AnyScope }

export class ScopedHandlerCapture extends Effect('fx/internal/ScopedHandlerCapture')<
  [ScopedHandlerCaptureTarget],
  readonly CapturedHandler[]
> { }

export const rootHandlerCaptureTarget: ScopedHandlerCaptureTarget = { type: 'root' }
export const nearestScopeHandlerCaptureTarget: ScopedHandlerCaptureTarget = { type: 'nearestScope' }

export const scopeHandlerCaptureTarget = (scope: AnyScope): ScopedHandlerCaptureTarget => ({
  type: 'scope',
  scope
})

export const captureScopedHandlers = (
  target: ScopedHandlerCaptureTarget
): Fx<ScopedHandlerCapture, readonly CapturedHandler[]> =>
  new ScopedHandlerCapture(target)

export const withScopedHandlerContext = <E, A>(
  context: readonly CapturedHandler[],
  fx: Fx<E, A>
): Fx<unknown, A> =>
  withHandlerContext(context, fx as Fx<unknown, unknown>) as Fx<unknown, A>
