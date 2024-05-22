import * as Async from './Async'
import { Effect } from './Effect'
import * as Fail from './Fail'
import * as Fork from './Fork'
import * as Fx from './Fx'
import * as Task from './Task'
import * as Queue from './internal/Queue'

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

export const withEmitter = <A>(f: (emitter: Emitter<A>) => Disposable): Fx.Fx<Async.Async | Stream<A>, void> =>
  Fx.fx(function* () {
    const queue = new Queue.UnboundedQueue<A>()

    const disposable = f({
      event(a) { queue.offer(a) },
      end() { dispose(queue) }
    })

    while (!queue.disposed) {
      const next = yield* Async.run<Queue.Take<A> | Queue.QueueDisposed>(() => queue.take())
      if (next.tag === 'fx/Queue/Take') yield* event(next.value)
    }

    dispose(disposable)
  })

export interface Emitter<A> {
  event(a: A): void
  end(): void
}

export const fromAsyncIterable: {
  <A, R>(iterable: AsyncGenerator<A, R>): Fx.Fx<Async.Async | Stream<A>, R>
  <A>(iterable: AsyncIterable<A>): Fx.Fx<Async.Async | Stream<A>, unknown>
} = <A>(iterable: AsyncIterable<A>): Fx.Fx<Async.Async | Stream<A>, unknown> => Fx.bracket(
  Fx.sync(() => iterable[Symbol.asyncIterator]()),
  iterator => Async.run(() => (iterator.return?.() ?? Promise.resolve()).then(() => { })),
  iterator => Fx.fx(function* () {
    let next = yield* Async.run(() => iterator.next())
    while (!next.done) {
      yield* event(next.value)
      next = yield* Async.run(() => iterator.next())
    }
    return next.value
  })
)

export const toAsyncIterable = <Error, Event, A>(fx: Fx.Fx<Async.Async | Fail.Fail<Error> | Stream<Event>, A>): AsyncIterable<Event> => ({
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

const dispose = (d: Disposable) => d[Symbol.dispose]()
