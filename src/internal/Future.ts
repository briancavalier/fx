import * as Async from '../Async';
import * as Fx from '../Fx';

export interface Future<E, A> {
  readonly state: 'Resolving' | 'Resolved';
  readonly wait: Fx.Fx<Async.Async | E, A>;
  readonly complete: (fx: Fx.Fx<E, A>) => boolean;
}

type FutureState<E, A> = Resolving<E, A> | Resolved<E, A>;

class Resolving<E, A> {
  readonly tag = 'Resolving';
  constructor(readonly observers: ((fx: Fx.Fx<E, A>) => void)[] = []) {}
}

class Resolved<E, A> {
  readonly tag = 'Resolved';
  constructor(readonly fx: Fx.Fx<E, A>) {}
}

export const make =<E, A>():  Future<E, A> => new FutureImpl();

class FutureImpl<E, A> implements Future<E, A> {
  private _state: FutureState<E, A> = new Resolving();

  get state() {
    return this._state.tag;
  }

  get wait() {
    return Fx.fx(this, function* () {
      if (this._state.tag === 'Resolving') {
        const observers = this._state.observers;
        return yield* yield* Async.run(
          signal =>
            new Promise<Fx.Fx<E, A>>(resolve => {
              observers.push(resolve);
              signal.addEventListener(
                'abort',
                () => observers.splice(observers.indexOf(resolve), 1),
                { once: true }
              );
            })
        );
      } else {
        return yield* this._state.fx;
      }
    });
  }

  complete(fx: Fx.Fx<E, A>) {
    if (this._state.tag === 'Resolving') {
      this._state.observers.forEach(observer => observer(fx));
      this._state = new Resolved(fx);
      return true;
    } else {
      return false;
    }
  }
}