import { Abort, abort } from './Abort'
import * as Async from './Async'
import * as Effect from './Effect'
import * as Fail from './Fail'
import * as Fork from './Fork'
import * as Fx from './Fx'
import * as Sink from './Sink'
import * as Task from './Task'
import * as Queue from './internal/Queue'
import { dispose } from './internal/disposable'
import { IfAny } from './internal/type'

/**
 * The Stream effect represents computations that may emit zero or more values of
 * a particular type before returning a final result.
 */
export class Stream<A> extends Effect.Effect('fx/Stream')<A, void> { }

export type Event<T> = T extends Stream<infer A> ? A : never

export type ExcludeStream<E, E2 = never> = Fx.Handle<E, Stream<any>, E2>

/**
 * Emit a single value
 */
export const emit = <const A>(a: A) => new Stream(a)

/**
 * Repeat the provided effectful computation forever, and emit each result
 */
export const repeat = <const E, const A>(fx: Fx.Fx<E, A>): Fx.Fx<E | Stream<A>, void> => Fx.fx(function* () {
  while (true) yield* emit(yield* fx)
})

/**
 * Apply an effectul function to each value in a stream
 */
export const forEach = <E, R, E2>(fx: Fx.Fx<E, R>, f: (a: Event<E>) => Fx.Fx<E2, void>): Fx.Fx<ExcludeStream<E, E2>, R> =>
  fx.pipe(Fx.handle(Stream, a => f(a as Event<E>)))

/**
 * Take the first n values from a stream
 */
export const take = (n: number) => <const E, const A, const R>(fx: Fx.Fx<E | Stream<A>, R>) => {
  let i = n
  return fx.pipe(Fx.control(Stream, (resume, a) => Fx.fx(function* () {
    if (i > 0) {
      --i
      return resume(yield* emit(a))
    } else {
      return yield* abort
    }
  }))) as Fx.Fx<Fx.Handle<E, Stream<A>, Stream<A> | Abort>, A>
}

/**
 * Transform each value in a stream
 */
export const map = <E, A, B>(fx: Fx.Fx<E, A>, f: (a: Event<E>) => B): Fx.Fx<ExcludeStream<E, Stream<B>>, A> =>
  forEach(fx, a => emit(f(a)))

/**
 * Drop values from the stream that don't satisfy the predicate
 */
export const filter: {
  <E, A, B extends Event<E>>(fx: Fx.Fx<E, A>, refinement: (a: Event<E>) => a is B): Fx.Fx<ExcludeStream<E, Stream<B>>, A>
  <E, A>(fx: Fx.Fx<E, A>, predicate: (a: Event<E>) => boolean): Fx.Fx<E, A>
} = <E, A>(fx: Fx.Fx<E, A>, predicate: (a: Event<E>) => boolean): Fx.Fx<ExcludeStream<E, Stream<Event<E>>>, A> =>
    forEach(fx, a => predicate(a) ? emit(a) : Fx.unit)

export const switchMap = <E, X, E2>(fx: Fx.Fx<E, X>, f: (a: Event<E>) => Fx.Fx<E2, unknown>): Fx.Fx<ExcludeStream<E, Fork.Fork | Async.Async | E2>, X> =>
  Fx.bracket(
    Fx.trySync(() => new CurrentTask<E2>()).pipe(Fail.assert),
    task => Fx.trySync(() => dispose(task)),
    task => Fx.fx(function* () {
      const x = yield* forEach(fx, a => task.run(f(a)))

      yield* task.wait()

      return x
    })
  ) as Fx.Fx<ExcludeStream<E, Fork.Fork | Async.Async | E2>, X>

/**
 * Create a stream that emits all values from a {@link Queue.Dequeue}
 */
export const fromDequeue = <A>(queue: Queue.Dequeue<A>): Fx.Fx<Async.Async | Stream<A>, void> => Fx.fx(function* () {
  const take = Queue.dequeue(queue)

  while (!queue.disposed) {
    const next = yield* take
    if (next.tag === 'fx/Queue/Dequeued') yield* emit(next.value)
  }
})

/**
 * Create a stream that emits all values enqueued by f
 */
export const withEnqueue = <A>(
  f: (o: Queue.Enqueue<A>) => Disposable,
  q: Queue.Queue<A> = new Queue.UnboundedQueue()
): Fx.Fx<Async.Async | Stream<A>, void> => Fx.bracket(
  Fx.trySync(() => f(q)).pipe(Fail.assert),
  disposable => Fx.ok(dispose(disposable)),
  _ => fromDequeue(q)
)

export interface IterableWithReturn<Y, R> {
  [Symbol.iterator](): Iterator<Y, R>
}

/**
 * Create a stream that emits all values from an Iterable
 */
export const fromIterable = <A, R>(i: IterableWithReturn<A, R>): Fx.Fx<Stream<A>, IfAny<R, void>> => Fx.bracket(
  Fx.trySync(() => i[Symbol.iterator]()).pipe(Fail.assert),
  iterator => Fx.ok(void iterator.return?.()),
  iterator => Fx.fx(function* () {
    let result = iterator.next()
    while (!result.done) {
      yield* emit(result.value)
      result = iterator.next()
    }
    return result.value
  })
) as Fx.Fx<Stream<A>, IfAny<R, void>>

export interface AsyncIterableWithReturn<Y, R> {
  [Symbol.asyncIterator](): AsyncIterator<Y, R>
}

/**
 * Create a stream that emits all values from an AsyncIterable
 */
export const fromAsyncIterable = <A, R>(f: () => AsyncIterableWithReturn<A, R>): Fx.Fx<Async.Async | Fail.Fail<unknown> | Stream<A>, R> => Fx.bracket(
  Fx.trySync(() => f()[Symbol.asyncIterator]()).pipe(Fail.assert),
  iterator => Async.tryPromise(() => iterator.return?.().then(() => { }) ?? Promise.resolve()).pipe(Fail.assert),
  iterator => Fx.fx(function* () {
    const next = Async.tryPromise(() => iterator.next())
    let result = yield* next
    while (!result.done) {
      yield* emit(result.value)
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

type Sinks<E> = E extends Sink.Sink<infer A> ? A : never

/**
 * Pipe all values from a stream into a sink.
 */
export const to = <E1, E2, R1, R2>(stream: Fx.Fx<E1, R1>, sink: Fx.Fx<E2, R2>): Fx.Fx<Exclude<E1, Stream<Sinks<E2>>> | Exclude<E2, Sink.Sink<any>>, R2> => Fx.fx(function* () {
  const sii = sink[Symbol.iterator]()
  const sti = stream[Symbol.iterator]()

  try {
    let sir = sii.next()
    let str = sti.next()

    while (true) {
      while (!sir.done && !str.done && !Sink.Sink.is(sir.value))
        sir = sii.next(yield sir.value)

      while (!sir.done && !str.done && !Stream.is(str.value))
        str = sti.next(yield str.value)

      if (sir.done) return sir.value
      if (str.done) return sii.return?.().value

      sir = sii.next((str.value as Stream<Sinks<E2>>).arg)
      str = sti.next()
    }
  } finally {
    sti.return?.()
    sii.return?.()
  }
}) as Fx.Fx<Exclude<E1, Stream<Sinks<E2>>> | Exclude<E2, Sink.Sink<any>>, R2>
