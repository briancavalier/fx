import { Abort, abort } from './Abort.js'
import { Async, assertPromise } from './Async.js'
import { Fork, fork } from './Concurrent.js'
import { Effect } from './Effect.js'
import { Fail } from './Fail.js'
import { Fx, assertSync, bracket, fx as gen, ok, unit } from './Fx.js'
import { Handle, control, handle } from './Handler.js'
import type { Interrupt } from './Interrupt.js'
import { Sink } from './Sink.js'
import { Task, wait as waitTask } from './Task.js'
import * as Queue from './internal/Queue.js'
import { dispose } from './internal/disposable.js'
import { IfAny } from './internal/type.js'

/**
 * The Stream effect represents computations that may emit zero or more values of
 * a particular type before returning a final result.
 */
export class Stream<A> extends Effect('fx/Stream')<A, void> { }

export const TakeScope = 'fx/Stream/take' as const

export type Event<T> = T extends Stream<infer A> ? A : never

export type ExcludeStream<E, E2 = never> = Handle<E, Stream<any>, E2>

/**
 * Emit a single value
 */
export const emit = <const A>(a: A) => new Stream(a)

/**
 * Repeat the provided effectful computation forever, and emit each result
 */
export const repeat = <const E, const A>(f: Fx<E, A>): Fx<E | Stream<A>, void> => gen(function* () {
  while (true) yield* emit(yield* f)
})

/**
 * Apply an effectful function to each value in a stream
 */
export const forEach = <E, R, E2>(f: Fx<E, R>, each: (a: Event<E>) => Fx<E2, void>): Fx<ExcludeStream<E, E2>, R> =>
  f.pipe(handle(Stream, stream => each(stream.arg as Event<E>)))

/**
 * Take the first n values from a stream
 */
export const take = (n: number) => <const E, const A, const R>(f: Fx<E | Stream<A>, R>) => {
  let i = n
  return f.pipe(control(Stream, (resume, stream) => gen(function* () {
    if (i > 0) {
      --i
      return resume(yield* emit(stream.arg))
    } else {
      return yield* abort(TakeScope)
    }
  }))) as Fx<Handle<E, Stream<A>, Stream<A> | Abort<typeof TakeScope>>, A>
}

/**
 * Transform each value in a stream
 */
export const map = <E, A, B>(f: Fx<E, A>, map: (a: Event<E>) => B): Fx<ExcludeStream<E, Stream<B>>, A> =>
  forEach(f, a => emit(map(a)))

/**
 * Drop values from the stream that don't satisfy the predicate
 */
export const filter: {
  <E, A, B extends Event<E>>(f: Fx<E, A>, refinement: (a: Event<E>) => a is B): Fx<ExcludeStream<E, Stream<B>>, A>
  <E, A>(f: Fx<E, A>, predicate: (a: Event<E>) => boolean): Fx<E, A>
} = <E, A>(f: Fx<E, A>, predicate: (a: Event<E>) => boolean): Fx<ExcludeStream<E, Stream<Event<E>>>, A> =>
    forEach(f, a => predicate(a) ? emit(a) : unit)

export const switchMap = <E, A, E2>(f: Fx<E, A>, each: (a: Event<E>) => Fx<E2, unknown>): Fx<ExcludeStream<E, Fork | Async | E2> | Interrupt, A> =>
  bracket(
    assertSync(() => new CurrentTask<E2>()),
    task => ok(dispose(task)),
    task => gen(function* () {
      const x = yield* forEach(f, a => task.run(each(a)))
      yield* task.wait()
      return x
    })
  ) as Fx<ExcludeStream<E, Fork | Async | E2> | Interrupt, A>

/**
 * Create a stream that emits all values from a {@link Queue.Dequeue}
 */
export const fromDequeue = <A>(queue: Queue.Dequeue<A>): Fx<Async | Stream<A>, void> => gen(function* () {
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
) => bracket(
  assertSync(() => f(q)),
  disposable => ok(dispose(disposable)),
  _ => fromDequeue(q)
)

export interface IterableWithReturn<Y, R> {
  [Symbol.iterator](): Iterator<Y, R>
}

/**
 * Create a stream that emits all values from an Iterable
 */
export const fromIterable = <A, R>(i: IterableWithReturn<A, R>): Fx<Stream<A> | Interrupt, IfAny<R, void>> => bracket(
  assertSync(() => i[Symbol.iterator]()),
  iterator => ok(void iterator.return?.()),
  iterator => gen(function* () {
    let result = iterator.next()
    while (!result.done) {
      yield* emit(result.value)
      result = iterator.next()
    }
    return result.value
  })
) as Fx<Stream<A> | Interrupt, IfAny<R, void>>

export interface AsyncIterableWithReturn<Y, R> {
  [Symbol.asyncIterator](): AsyncIterator<Y, R>
}

/**
 * Create a stream that emits all values from an AsyncIterable
 */
export const fromAsyncIterable = <A, R>(f: () => AsyncIterableWithReturn<A, R>): Fx<Async | Stream<A> | Interrupt, R> => bracket(
  assertSync(() => f()[Symbol.asyncIterator]()),
  iterator => assertPromise(() => iterator.return?.().then(() => { }) ?? Promise.resolve()),
  iterator => gen(function* () {
    const next = assertPromise(() => iterator.next())
    let result = yield* next
    while (!result.done) {
      yield* emit(result.value)
      result = yield* next
    }
    return result.value
  })
)

export const toAsyncIterable = <E extends Async | Stream<any> | Fail<any>, A>(f: Fx<E, A>): AsyncIterableWithReturn<Event<E>, A> => ({
  async *[Symbol.asyncIterator]() {
    const controller = new AbortController()
    const iterator = f[Symbol.iterator]()
    let result = iterator.next()

    try {
      while (!result.done) {
        const next = result.value
        if (next._fxEffectId === 'fx/Async') {
          const value = await next.arg.run(controller.signal)
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
  private task: Task<any, Extract<E, Fail<any>>> | null = null

  run<A>(f: Fx<E, A>) {
    return gen(this, function* () {
      dispose(this)

      this.task = yield* fork(gen(this, function* () {
        const x = yield* f
        this.task = null
        return x
      }))
    })
  }

  wait() {
    return this.task ? waitTask(this.task) : unit
  }

  [Symbol.dispose]() {
    if (this.task) {
      dispose(this.task)
      this.task = null
    }
  }
}

type Sinks<E> = E extends Sink<infer A> ? A : never

/**
 * Pipe all values from a stream into a sink.
 */
export const to = <E1, E2, R1, R2>(stream: Fx<E1, R1>, sink: Fx<E2, R2>): Fx<Exclude<E1, Stream<Sinks<E2>>> | Exclude<E2, Sink<any>>, R2> => gen(function* () {
  const sii = sink[Symbol.iterator]()
  const sti = stream[Symbol.iterator]()

  try {
    let sir = sii.next()
    let str = sti.next()

    while (true) {
      while (!sir.done && !str.done && !Sink.is(sir.value))
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
}) as Fx<Exclude<E1, Stream<Sinks<E2>>> | Exclude<E2, Sink<any>>, R2>
