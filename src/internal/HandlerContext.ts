import { Fx } from '../Fx'

export interface HandlerContext extends Fx<unknown, unknown> {
  readonly handlers: ReadonlyMap<unknown, (e: unknown) => Fx<unknown, unknown>>
  readonly controls: ReadonlyMap<unknown, (resume: (a: any) => unknown, e: unknown) => Fx<unknown, unknown>>
}
