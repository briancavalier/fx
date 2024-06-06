import { Effect } from '../Effect'
import { Fx } from '../Fx'

export interface HandlerContext extends Fx<unknown, unknown> {
  readonly handlers: ReadonlyMap<unknown, (e: unknown) => Fx<unknown, unknown>>
}

export class GetHandlerContext extends Effect('fx/GetHandlerContext')<void, readonly HandlerContext[]> { }

export const getHandlerContext = new GetHandlerContext()
