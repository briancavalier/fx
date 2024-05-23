import * as Async from '../Async'
import { Fx } from '../Fx'
import { Variant } from './Variant'

export type Sink<A> = (a: A) => void

export type Taken<A> = Variant<'fx/Queue/Taken', A>

export type QueueDisposed = Variant<'fx/Queue/Disposed', void>

const queueDisposed: QueueDisposed = { tag: 'fx/Queue/Disposed', value: undefined }

export interface Queue<A> extends Disposable {
  offer(a: A): boolean
  take(): Promise<Taken<A> | QueueDisposed>
  readonly disposed: boolean
}

export type Offer<A> = Omit<Queue<A>, 'take'>
export type Take<A> = Omit<Queue<A>, 'offer'>

export const take = <A>(q: Take<A>): Fx<Async.Async, Taken<A> | QueueDisposed> => Async.run(() => q.take())

export class UnboundedQueue<A> {
  private readonly items: A[] = []
  private readonly takers: Sink<Taken<A> | QueueDisposed>[] = []
  private _disposed = false

  offer(a: A) {
    if (this._disposed) return false

    if (this.takers.length > 0) this.takers.shift()!({ tag: 'fx/Queue/Taken', value: a })
    else this.items.push(a)
    return true
  }

  async take(): Promise<Taken<A> | QueueDisposed> {
    if (this._disposed) return queueDisposed

    if (this.items.length > 0) return { tag: 'fx/Queue/Taken', value: this.items.shift()! } as const
    else return new Promise<Taken<A> | QueueDisposed>(resolve => this.takers.push(resolve))
  }

  get disposed() {
    return this._disposed
  }

  [Symbol.dispose]() {
    if (this._disposed) return
    this._disposed = true
    this.items.length = 0
    for (const taker of this.takers) taker(queueDisposed)
    this.takers.length = 0
  }
}
