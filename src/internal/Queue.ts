import * as Async from "../Async";
import * as Fail from "../Fail";
import * as Future from "./Future";
import * as Fx from "../Fx";

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

export const make = <A>(): Queue<A> => new QueueImpl<A>()

class QueueImpl<A> implements Queue<A> {
  private _queue: A[] = [];
  private _takers: Future.Future<Fail.Fail<QueueShutdown>, A>[] = [];
  private _isShutdown = false;

  offer = (a: A) =>
    Fx.fx(this, function* () {
      if (this._isShutdown) {
        return false
      }
      else if (this._takers.length === 0) {
        this._queue.push(a);
        return true
      } else {
        const taker = this._takers.shift()!;
        taker.complete(Fx.ok(a));
        return true
      }
    });
  
  take = Fx.fx(this, function* () { 
    if (this._isShutdown) {
      return yield* Fail.fail(new QueueShutdown());
    }

    if (this._queue.length === 0) {
      const future = Future.make<Fail.Fail<QueueShutdown>, A>();
      this._takers.push(future);
      return yield* future.wait;
    } else {
      return this._queue.shift()!;
    }
  })

  shutdown = Fx.fx(this, function* () { 
    if (this._isShutdown) {
      return false;
    }

    this._isShutdown = true;

    for (const taker of this._takers) {
      taker.complete(Fail.fail(new QueueShutdown()));
    }

    this._takers = [];
    this._queue = [];

    return true;
  })

  isShutdown = Fx.sync(() => this._isShutdown);
}

export const take = <A>(
  queue: Queue<A>
): Fx.Fx<
  Async.Async,
  QueueShutdown | Take<A>
>  => queue.take.pipe(
    Fx.map((a) => new Take(a)),
    Fail.catchAll
  )
