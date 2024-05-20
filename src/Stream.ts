import { Effect } from "./Effect";
import * as Fx from "./Fx";
import * as Task from "./Task";
import * as Async from "./Async";
import * as Fail from "./Fail";
import * as Fork from "./Fork";
import * as Queue from './internal/Queue';

export class Stream<A> extends Effect('Stream')<A, void> { }

export type Event<T> = T extends Stream<infer A> ? A : never

export type ExcludeStream<E> = Exclude<E, Stream<any>>

export const event = <const A>(a: A): Fx.Fx<Stream<A>, void> => new Stream(a)

export const forEach = <E, R, E2>(fx: Fx.Fx<E, R>, f: (a: Event<E>) => Fx.Fx<E2, void>): Fx.Fx<ExcludeStream<E> | E2, R> =>
  fx.pipe(Fx.handle(Stream, (a) => f(a as Event<E>)))

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
    (task) => Fx.sync(() => dispose(task)),
    (task) => Fx.fx(function* () {
      const x = yield* forEach(fx, a => task.run(f(a)))

      yield* task.wait()

      return x
    })
  )

export const withEmitter = <A, E>(f: (emitter: Emitter<A>) => Fx.Fx<E, Disposable>): Fx.Fx<Async.Async | Fork.Fork | Stream<A> | E, void> =>
  Fx.fx(function* () { 
    const queue = Queue.make<A>()
    let disposable: Disposable | null = null

    const fiber = yield* Fork.fork(Fx.fx(function* () { 
      disposable = yield* f({
        event(a) { 
          Fx.runSync(queue.offer(a))
        },
        end() { 
          Fx.runSync(queue.shutdown)
        }
      })

      yield* Async.never
    }))

    while (true) { 
      const next = yield* Queue.take(queue)
      if (next.tag === 'QueueShutdown') break
      yield* event(next.value)
    }

    if (disposable) {
      dispose(disposable)
    }
    dispose(fiber)
  })

export interface Emitter<A> { 
  event(a: A): void
  end(): void
}

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

function dispose(disposable: Disposable) {
  disposable[Symbol.dispose]()
}

