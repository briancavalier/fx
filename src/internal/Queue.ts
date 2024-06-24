import * as Async from '../Async'
import { Fx } from '../Fx'
import { Variant } from './Variant'

export type Sink<A> = (a: A) => void

export type Dequeued<A> = Variant<'fx/Queue/Dequeued', A>

export type Disposed = Variant<'fx/Queue/Disposed', void>

const queueDisposed: Disposed = { tag: 'fx/Queue/Disposed', value: undefined }

export interface Queue<A> extends Disposable {
  enqueue(a: A): boolean
  dequeue(): Promise<Dequeued<A> | Disposed>
  readonly disposed: boolean
}

export type Enqueue<A> = Pick<Queue<A>, 'enqueue' | 'disposed' | keyof Disposable>
export type Dequeue<A> = Pick<Queue<A>, 'dequeue' | 'disposed' | keyof Disposable>

export const dequeue = <A>(q: Dequeue<A>): Fx<Async.Async, Dequeued<A> | Disposed> => Async.assertPromise(() => q.dequeue())

export class UnboundedQueue<A> implements Queue<A> {
  private readonly items: A[] = []
  private readonly takers: Sink<Dequeued<A> | Disposed>[] = []
  private _disposed = false

  enqueue(a: A) {
    if (this._disposed) return false

    if (this.takers.length > 0) this.takers.shift()!({ tag: 'fx/Queue/Dequeued', value: a })
    else this.items.push(a)
    return true
  }

  async dequeue(): Promise<Dequeued<A> | Disposed> {
    if (this._disposed) return queueDisposed

    if (this.items.length > 0) return { tag: 'fx/Queue/Dequeued', value: this.items.shift()! } as const
    else return new Promise<Dequeued<A> | Disposed>(resolve => this.takers.push(resolve))
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
