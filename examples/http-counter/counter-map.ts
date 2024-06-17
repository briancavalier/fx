import { Fx } from "../../src";
import { Next } from "./counter";

// A simple in-memory Counter backed by a Map

export const mapCounter = <E, A>(f: Fx.Fx<E, A>) => {
  const store = new Map<string, number>();
  return f.pipe(
    Fx.handle(Next, (key) => {
      const value = (store.get(key) ?? 0) + 1;
      store.set(key, value);
      return Fx.ok(value);
    })
  );
};
