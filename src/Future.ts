import * as Async from "./Async";
import * as Fx from "./Fx";

export interface Future<E, A> {
  readonly state: FutureState<E, A>;
  readonly wait: Fx.Fx<Async.Async | E, A>;
  readonly complete: (fx: Fx.Fx<E, A>) => boolean;
}

export type FutureState<E, A> = Resolving<E, A> | Resolved<E, A>;

export class Resolving<E, A> {
  readonly tag = "Resolving";
  constructor(readonly observers: ((fx: Fx.Fx<E, A>) => void)[] = []) {}
}

export class Resolved<E, A> {
  readonly tag = "Resolved";
  constructor(readonly fx: Fx.Fx<E, A>) {}
}

export const make =<E, A>(): Fx.Fx<never, Future<E, A>> =>
  Fx.fx(function* () {
    let state: FutureState<E, A> = new Resolving();

    const wait = Fx.fx(function* () {
      if (state.tag === "Resolving") {
        const observers = state.observers;
        return yield* yield* Async.run(
          (signal) =>
            new Promise<Fx.Fx<E, A>>((resolve) => {
              observers.push(resolve);
              signal.addEventListener(
                "abort",
                () => observers.splice(observers.indexOf(resolve), 1),
                { once: true }
              );
            })
        );
      } else {
        return yield* state.fx;
      }
    });

    const complete = (fx: Fx.Fx<E, A>) => {
      if (state.tag === "Resolving") {
        state.observers.forEach((observer) => observer(fx));
        state = new Resolved(fx);
        return true;
      } else {
        return false;
      }
    };

    return {
      get state() {
        return state;
      },
      complete,
      wait,
    };
  })
