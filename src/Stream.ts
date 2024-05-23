import * as Async from './Async'
import { Effect } from './Effect'
import * as Fail from './Fail'
import * as Fork from './Fork'
import * as Fx from './Fx'
import * as Task from './Task'
import * as Queue from './internal/Queue'
import { dispose } from './internal/disposable'
import { IfAny } from './internal/type'

export class Stream<A> extends Effect('fx/Stream')<A, void> { }

export type Event<T> = T extends Stream<infer A> ? A : never

export type ExcludeStream<E> = Exclude<E, Stream<any>>

export const event = <const A>(a: A) => new Stream(a)

export const forEach = <E, R, E2>(fx: Fx.Fx<E, R>, f: (a: Event<E>) => Fx.Fx<E2, void>): Fx.Fx<ExcludeStream<E> | E2, R> =>
  fx.pipe(Fx.handle(Stream, a => f(a as Event<E>)))

export const map = <E, A, B>(fx: Fx.Fx<E, A>, f: (a: Event<E>) => B): Fx.Fx<ExcludeStream<E> | Stream<B>, A> =>
  forEach(fx, a => event(f(a)))

export const filter: {
  <E, A, B extends Event<E>>(fx: Fx.Fx<E, A>, refinement: (a: Event<E>) => a is B): Fx.Fx<ExcludeStream<E> | Stream<B>, A>
  <E, A>(fx: Fx.Fx<E, A>, predicate: (a: Event<E>) => boolean): Fx.Fx<ExcludeStream<E> | Stream<Event<E>>, A>
} = <E, A>(fx: Fx.Fx<E, A>, predicate: (a: Event<E>) => boolean): Fx.Fx<ExcludeStream<E> | Stream<Event<E>>, A> =>
    forEach(fx, a => predicate(a) ? event(a) : Fx.unit)

export const switchMap = <E, X, E2>(fx: Fx.Fx<E, X>, f: (a: Event<E>) => Fx.Fx<E2, unknown>): Fx.Fx<Fork.Fork | Async.Async | ExcludeStream<E> | E2, X> =>
  Fx.bracket(
    Fx.sync(() => new CurrentTask<ExcludeStream<E> | E2>()),
    task => Fx.sync(() => dispose(task)),
    task => Fx.fx(function* () {
      const x = yield* forEach(fx, a => task.run(f(a)))

      yield* task.wait()

      return x
    })
  )

export const fromQueue = <A>(queue: Queue.Dequeue<A>): Fx.Fx<Async.Async | Stream<A>, void> => Fx.fx(function* () {
  const take = Queue.dequeue(queue)

  while (!queue.disposed) {
    const next = yield* take
    if (next.tag === 'fx/Queue/Dequeued') yield* event(next.value)
  }
})

export const withEmitter = <A>(
  f: (o: Queue.Enqueue<A>) => Disposable,
  q: Queue.Queue<A> = new Queue.UnboundedQueue()
): Fx.Fx<Async.Async | Stream<A>, void> =>
  Fx.bracket(
    Fx.sync(() => f(q)),
    disposable => Fx.ok(dispose(disposable)),
    _ => fromQueue(q))

export interface IterableWithReturn<Y, R> {
  [Symbol.iterator](): Iterator<Y, R>
}

export const fromIterable = <A, R>(i: IterableWithReturn<A, R>): Fx.Fx<Stream<A>, IfAny<R, void>> => Fx.bracket(
  Fx.sync(() => i[Symbol.iterator]()),
  iterator => Fx.ok(void iterator.return?.()),
  iterator => Fx.fx(function* () {
    let result = iterator.next()
    while (!result.done) {
      yield* event(result.value)
      result = iterator.next()
    }
    return result.value
  })
) as Fx.Fx<Stream<A>, IfAny<R, void>>

export interface AsyncIterableWithReturn<Y, R> {
  [Symbol.asyncIterator](): AsyncIterator<Y, R>
}

export const fromAsyncIterable = <A, R>(f: () => AsyncIterableWithReturn<A, R>): Fx.Fx<Async.Async | Stream<A>, R> => Fx.bracket(
  Fx.sync(() => f()[Symbol.asyncIterator]()),
  iterator => Async.run(() => iterator.return?.().then(() => { }) ?? Promise.resolve()),
  iterator => Fx.fx(function* () {
    const next = Async.run(() => iterator.next())
    let result = yield* next
    while (!result.done) {
      yield* event(result.value)
      result = yield* next
    }
    return result.value
  })
)

export const toAsyncIterable = <E extends Async.Async | Stream<any> | Fail.Fail<any>, A>(fx: Fx.Fx<E, A>): AsyncIterableWithReturn<Event<E>, A> => ({
  async *[Symbol.asyncIterator]() {
    const controller = new AbortController()
    const iterator = fx[Symbol.iterator]()
    let result = iterator.next()

    try {
      while (!result.done) {
        const next = result.value
        if (next._fxEffectId === 'fx/Async') {
          const value = await next.arg(controller.signal)
          result = iterator.next(value)
        } else if (next._fxEffectId === 'fx/Fail') {
          throw next.arg
        } else {
          yield next.arg
          result = iterator.next()
        }
      }
      return result.value
    } finally {
      controller.abort()
      iterator.return?.()
    }
  }
})

class CurrentTask<E> {
  private task: Task.Task<any, Extract<E, Fail.Fail<any>>> | null = null

  run<A>(fx: Fx.Fx<E, A>) {
    return Fx.fx(this, function* () {
      dispose(this)

      this.task = yield* Fork.fork(Fx.fx(this, function* () {
        const x = yield* fx
        this.task = null
        return x
      }))
    })
  }

  wait() {
    return this.task ? Task.wait(this.task) : Fx.unit
  }

  [Symbol.dispose]() {
    if (this.task) {
      dispose(this.task)
      this.task = null
    }
  }
}
