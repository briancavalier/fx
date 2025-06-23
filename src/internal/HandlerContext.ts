import { Effect } from '../Effect'
import { Fx } from '../Fx'

export interface HandlerContext extends Fx<unknown, unknown> {
  readonly effectId: unknown
  readonly handler: (e: unknown) => Fx<unknown, unknown>
}

export class GetHandlerContext extends Effect('fx/GetHandlerContext')<void, readonly HandlerContext[]> { }

export const getHandlerContext = new GetHandlerContext()
