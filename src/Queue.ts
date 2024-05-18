import * as Async from "./Async";
import * as Fail from "./Fail";
import * as Future from "./Future";
import * as Fx from "./Fx";

export interface Queue<A> {
  readonly offer: (a: A) => Fx.Fx<never, boolean>;
  readonly take: Fx.Fx<Async.Async | Fail.Fail<QueueShutdown>, A>;
  readonly isShutdown: Fx.Fx<never, boolean>;
  readonly shutdown: Fx.Fx<never, boolean>;
}

export class QueueShutdown {
  readonly tag = "QueueShutdown";
}

export class Take<A> {
  readonly tag = "Take";
  constructor(readonly value: A) {}
}

export const make = <A>(): Fx.Fx<never, Queue<A>> =>
  Fx.fx(function* () {
    let queue: A[] = [];
    let takers: Future.Future<Fail.Fail<QueueShutdown>, A>[] = [];
    let isShutdown = false;

    const offer = (a: A) =>
      Fx.fx(function* () {
        if (isShutdown) {
          return false
        }
        else if (takers.length === 0) {
          queue.push(a);
          return true
        } else {
          const taker = takers.shift()!;
          taker.complete(Fx.ok(a));
          return true
        }
      });

    const take = Fx.fx(function* () {
      if (isShutdown) {
        return yield* Fail.fail(new QueueShutdown());
      }

      if (queue.length === 0) {
        const future = yield* Future.make<Fail.Fail<QueueShutdown>, A>();
        takers.push(future);
        return yield* future.wait;
      } else {
        return queue.shift()!;
      }
    });

    const shutdown = Fx.fx(function* () {
      if (isShutdown) {
        return false;
      }

      isShutdown = true;

      for (const taker of takers) {
        taker.complete(Fail.fail(new QueueShutdown()));
      }

      takers = [];
      queue = [];

      return true;
    });

    return {
      offer,
      take,
      isShutdown: Fx.sync(() => isShutdown),
      shutdown,
    };
  });

export const take = <A>(
  queue: Queue<A>
): Fx.Fx<
  Async.Async,
  QueueShutdown | Take<A>
>  => queue.take.pipe(
    Fx.map((a) => new Take(a)),
    Fail.catchAll
  )
